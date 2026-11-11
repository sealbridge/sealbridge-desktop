import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { mkdtemp, rm, readFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createSendApproval } from "./context-send-approval.mjs";
import { createContextSender, launchContextSend } from "./context-send.mjs";
import { executeContextSend } from "./context-send-core.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";
import { loadCoreSdk } from "./sdk.mjs";
import { sanitizedEnvironment } from "./mcp-host.mjs";

const packageDir = path.join(developmentRuntimeDir, "node_modules/sealbridge-local");
const load = name => import(pathToFileURL(path.join(packageDir, "dist", name)).href);
const sdk = await loadCoreSdk(packageDir);
const core = await load("packages/core/dist/index.js");
const relayApi = await load("packages/relay/dist/index.js");
const draft = { selectors: ["$.items"], fieldsAllowed: ["size"], fieldsDenied: ["customer"], angle: "可否だけ",
  body: "DW1_TRANSIENT_INPUT_" + "SYNTHETIC_MARKER", deliveryMode: "view_only", lifetimeHours: 24 };

async function absentDuringScan(error) {
  if (error.code === "ENOENT") return Buffer.alloc(0);
  throw error;
}

async function allBytes(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return Buffer.concat(await Promise.all(entries.map(entry => (entry.isDirectory()
    ? allBytes(path.join(dir, entry.name)) : readFile(path.join(dir, entry.name))).catch(absentDuringScan))));
}

for (const linked of [false, true]) {
  test(`context send child runs through a ${linked ? "symlink" : "direct path"}`, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), "context-send-entry-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let entry = fileURLToPath(new URL("./context-send-child.mjs", import.meta.url));
    if (linked) {
      const link = path.join(dir, "child.mjs");
      try { await symlink(entry, link, "file"); }
      catch (error) {
        if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) {
          t.skip(`symlinks unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      entry = link;
    }
    const child = spawn(process.execPath, [entry], { cwd: dir, env: sanitizedEnvironment(process.env, dir) });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 10_000);
    t.after(() => clearTimeout(timer));
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(JSON.stringify({ type: "start" }) + "\n");
    assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
    assert.deepEqual(stdout.trim().split("\n").map(line => JSON.parse(line)), [
      { type: "result", state: "failed", peerRejected: false },
    ]);
  });
}

test("connected unpublished peers retain the protocol floor for owner and agent lookups", async () => {
  const before = process.stdin.eventNames().map(name => [name, process.stdin.listenerCount(name)]);
  const { createProtocolPeers } = await import("./context-send-child.mjs");
  assert.deepEqual(process.stdin.eventNames().map(name => [name, process.stdin.listenerCount(name)]), before);
  const connected = { peerOwnerDid: "did:fixture:owner", peerAgentDid: "did:fixture:agent" };
  const calls = [];
  const observed = {
    version: undefined,
    floor(peer, agent) { calls.push([peer, agent]); return this.version; },
    observe(value) { assert.equal(this, observed); return value; },
    observePolicy(value) { assert.equal(this, observed); return value; },
  };
  const peers = createProtocolPeers(observed, connected);
  assert.equal(peers.floor(connected.peerOwnerDid, connected.peerOwnerDid), "0.2.0");
  assert.equal(peers.floor(connected.peerOwnerDid, connected.peerAgentDid), "0.2.0");
  assert.equal(peers.floor("did:fixture:other", connected.peerAgentDid), undefined);
  assert.equal(peers.floor(connected.peerOwnerDid, "did:fixture:other"), undefined);
  assert.deepEqual(calls[0], [connected.peerOwnerDid, connected.peerOwnerDid]);
  observed.version = "0.3.0";
  assert.equal(peers.floor(connected.peerOwnerDid, connected.peerOwnerDid), "0.3.0");
  assert.equal(peers.floor("did:fixture:other", "did:fixture:other"), "0.3.0");
  observed.version = undefined;
  assert.equal(peers.floor(connected.peerOwnerDid, connected.peerOwnerDid), "0.2.0");
  assert.equal(createProtocolPeers(observed, { peerOwnerDid: connected.peerOwnerDid })
    .floor(connected.peerOwnerDid, connected.peerOwnerDid), "0.2.0");
  assert.equal(peers.observe("observation"), "observation");
  assert.equal(peers.observePolicy("policy"), "policy");
});

test("human approval binds the displayed digest to the request immediately before signing", async () => {
  const owner = sdk.generateKeyPair(), worker = sdk.generateKeyPair();
  for (const mutation of ["none", "request", "invalid", "card", "deny", "abort"]) {
    const manifest = sdk.buildTaskManifest({ ownerDid: owner.did, workerDid: worker.did, title: "fixture", description: "fixture",
      contextGrant: { selectors: draft.selectors, angle: draft.angle } });
    const signal = new AbortController();
    const request = { taskId: manifest.taskId, gate: "contract_acceptance", target: manifest,
      details: { manifest, bytes: Buffer.byteLength(JSON.stringify(draft.body)) }, signal: signal.signal };
    let shown;
    const provider = createSendApproval({ sdk, owner, signApproval: sdk.signApproval, ask: async card => {
      shown = structuredClone(card);
      assert.equal(card.digest, sdk.contextGrantAuditPayload(request.details.manifest.contextGrant).grantDigest);
      if (mutation === "request") manifest.contextGrant.angle = "different";
      if (mutation === "invalid") manifest.contextGrant.extra = true;
      if (mutation === "card") card.digest = "different";
      if (mutation === "abort") signal.abort();
      return mutation !== "deny";
    } });
    assert.equal(provider.kind, "human"); assert.equal(provider.ownerDecision, true);
    const receipt = await provider.approve(request);
    assert.equal(receipt.payload.decision, mutation === "none" ? "APPROVED" : "REJECTED");
    assert.equal(JSON.stringify(shown).includes(draft.body), false);
  }
});

test("missing or out-of-data audit path prevents spawning", () => {
  let calls = 0;
  for (const auditPath of [undefined, "relative.jsonl", path.join(tmpdir(), "elsewhere.jsonl")]) {
    assert.throws(() => launchContextSend({ runtimeDir: tmpdir(), dataDir: tmpdir(), auditPath,
      home: tmpdir(), spawnChild: () => { calls++; } }), /AUDIT_PATH_REQUIRED/);
  }
  assert.equal(calls, 0);
});

test("recipient list excludes pending, invitations, public workers and self, and never exposes routing credentials", async () => {
  const self = sdk.generateKeyPair().did, peer = sdk.generateKeyPair().did;
  const rows = [{ peerOwnerDid: self, relayUrl: "https://relay.example", state: "connected" },
    { peerOwnerDid: peer, peerDisplayName: "fixture", relayUrl: "https://relay.example", state: "connected", inviteToken: "private-invite" },
    { peerOwnerDid: sdk.generateKeyPair().did, relayUrl: "https://relay.example", state: "pending" }];
  const sender = createContextSender({ service: { listConnections: async () => ({ connections: rows }), status: () => ({ did: self }) } });
  const recipients = await sender.recipients();
  assert.equal(recipients.length, 1);
  assert.deepEqual(Object.keys(recipients[0]), ["id", "name", "did", "state"]);
  assert.equal(JSON.stringify(recipients).includes(peer), false);
  assert.equal(JSON.stringify(recipients).includes("private-invite"), false);
  rows[1].state = "pending";
  assert.deepEqual(await sender.start(recipients[0].id, draft), { ok: false });
});

test("audit directory failure prevents spawning", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw1-audit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const peer = sdk.generateKeyPair().did;
  let calls = 0;
  const sender = createContextSender({ dataDir: path.join(dir, "missing", "..", "..", "invalid", "\0"),
    service: { listConnections: async () => ({ connections: [{ state: "connected", peerOwnerDid: peer, relayUrl: "https://relay.example" }] }), status: () => ({ did: "self" }) },
    launch: () => { calls++; } });
  const [recipient] = await sender.recipients();
  assert.deepEqual(await sender.start(recipient.id, draft), { ok: false });
  assert.equal(calls, 0);
});

for (const mode of ["view_only", "hand_over"]) test(`local relay and bundled CLI worker deliver ${mode}, final human approval, no plaintext input on disk`, { timeout: 45000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw1-cli-"));
  const relay = await relayApi.startLocalRelay();
  const owner = sdk.generateKeyPair(), workerOwner = sdk.generateKeyPair();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(dir, "worker-key.json"), JSON.stringify(workerOwner), { mode: 0o600 });
  await writeFile(path.join(dir, "contacts.json"), JSON.stringify(core.signPayload({ version: 1, ownerDid: workerOwner.did, contacts: [{
    displayName: "fixture sender", ownerDid: owner.did, agentDid: owner.did, relay: relay.url,
    verifiedAt: new Date().toISOString(), allow: true, revoked: false, saved: true,
  }] }, workerOwner)));
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const entry = path.resolve(packageDir, manifest.bin["sealbridge-local"]);
  const workerNode = process.versions.electron ? execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim() : process.execPath;
  const worker = spawn(workerNode, [entry, "worker", "start", "--key", path.join(dir, "worker-key.json"),
    "--relay", relay.url, "--allow-private-relay", "--allow-local-pc", "--contacts", path.join(dir, "contacts.json"), "--adapter", "sandbox",
    "--cmd", "return {ok: true};", "--auto-approve", "--once", "--invite-output", "none", "--audit", path.join(dir, "worker.jsonl")],
  { cwd: dir, env: { ...sanitizedEnvironment(process.env, dir), SEALBRIDGE_DATA_DIR: dir, ACP_DATA_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise(resolve => worker.once("close", resolve));
  let log = "", exited = false;
  worker.once("exit", () => { exited = true; });
  worker.stdout.on("data", chunk => { log += chunk; });
  const lines = createInterface({ input: worker.stderr });
  const ready = new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", () => reject(new Error("CLI_EXIT_BEFORE_READY")));
    lines.on("line", line => { log += line; try { if (JSON.parse(line).event === "invite_ready") resolve(); } catch {} });
  });
  t.after(async () => { if (!exited) worker.kill(); await closed; await relay.close(); await rm(dir, { recursive: true, force: true }); });
  await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("CLI_READY_TIMEOUT")), 10000); timer.unref(); })]);
  const cards = [], events = [];
  const result = await executeContextSend({ sdk, owner, signApproval: sdk.signApproval, draft: { ...draft, deliveryMode: mode },
    target: { peerOwnerDid: workerOwner.did, relayUrl: relay.url }, auditPath: path.join(dir, "sender.jsonl"),
    identityOptions: { env: { SEALBRIDGE_DATA_DIR: dir } }, clientOptions: { allowPrivateRelay: true, timeoutMs: 20000, protocolPeers: { floor: () => "0.2.0", observePolicy: policy => policy, observe: () => {} } },
    ask: async card => { cards.push(card); return true; }, send: event => events.push(event) });
  assert.equal(result.state, "SETTLED");
  assert.deepEqual(result.deliverable, { ok: true });
  assert.deepEqual(cards.map(card => card.gate), ["contract_acceptance", "final_verification"]);
  assert.equal(cards[0].digest, cards[1].digest);
  assert.equal(events.at(-1).state, "completed");
  assert.equal((await allBytes(dir)).includes(Buffer.from(draft.body)), false);
  assert.equal(JSON.stringify([cards, events, log]).includes(draft.body), false);
  const audit = await readFile(path.join(dir, "sender.jsonl"), "utf8");
  const grantEntry = audit.trim().split("\n").map(line => JSON.parse(line).entry).find(entry => entry?.body.eventType === "CONTEXT_GRANT");
  assert.equal(grantEntry.body.payload.grantDigest, cards[0].digest);
  assert.equal(result.bundle.entries.some(entry => entry.body.eventType === "CONTEXT_OPENED"), true);
  for (const type of ["CONTEXT_GRANT", "CONTEXT_MODE", "CONTEXT_OPENED", "CONTEXT_DELETION_ATTEMPTED"]) assert.ok(audit.includes(type));
});

test("send process IPC correlates approval, status and cancellation without disk or automatic retry", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw1-ipc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const peer = sdk.generateKeyPair().did;
  const children = [], launches = [], sent = [];
  const sender = createContextSender({ dataDir: dir, runtimeDir: dir,
    service: { status: () => ({ did: "self" }), listConnections: async () => ({ connections: [
      { state: "connected", peerOwnerDid: peer, relayUrl: "https://relay.example" },
    ] }) }, launch: options => {
      launches.push(options);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin.on("data", chunk => sent.push(chunk.toString()));
      child.kill = () => child.emit("close", 0);
      children.push(child); return child;
    } });
  const [recipient] = await sender.recipients();
  const attempt = sender.start(recipient.id, draft);
  assert.deepEqual(await sender.start(recipient.id, draft), { ok: false });
  assert.deepEqual(await attempt, { ok: true });
  const first = children[0];
  assert.equal(JSON.parse(sent.join("").trim()).auditPath, launches[0].auditPath);
  assert.ok(launches[0].auditPath.startsWith(path.join(dir, "context-audits") + path.sep));
  first.stdout.write(JSON.stringify({ type: "approval", id: 9, card: { digest: "digest", gate: "contract_acceptance" } }) + "\n");
  assert.equal(sender.status().approval.id, 9);
  assert.deepEqual(sender.answer(8, true), { ok: false });
  assert.deepEqual(sender.answer(9, true), { ok: true });
  assert.deepEqual(sender.answer(9, true), { ok: false });
  first.stdout.write(JSON.stringify({ type: "result", state: "failed", peerRejected: true }) + "\n");
  assert.equal(sender.status().peerRejected, true);
  first.emit("close", 0);
  assert.equal(launches.length, 1);
  assert.equal(JSON.stringify(sender.status()).includes(draft.body), false);
  sender.reset();
  const approvalDraft = { ...draft, deliveryMode: "approval_redelegation" };
  assert.deepEqual(await sender.start(recipient.id, approvalDraft), { ok: true });
  assert.notEqual(launches[0].auditPath, launches[1].auditPath);
  const launched = JSON.parse(sent.join("").trim().split("\n").at(-1));
  assert.equal(launched.draft.deliveryMode, "approval_redelegation");
  assert.equal(launched.draft.body, draft.body);
  children[1].stdout.write(JSON.stringify({ type: "result", state: "failed", peerRejected: true }) + "\n");
  children[1].emit("close", 0);
  assert.equal(launches.length, 2);
  assert.equal(sender.status().peerRejected, true);
  sender.reset();
  assert.deepEqual(await sender.start(recipient.id, approvalDraft), { ok: true });
  sender.cancel(true);
  assert.equal(sender.status().state, "cancelled");
  assert.equal(launches.length, 3);
  assert.equal((await allBytes(dir)).includes(Buffer.from(draft.body)), false);
});
