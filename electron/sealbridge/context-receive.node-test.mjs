import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { sanitizedEnvironment } from "./mcp-host.mjs";
import { contextSendFailureState } from "./context-send-core.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createContextReceiver } from "./context-receive-core.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { launchContextReceive, createDesktopReceiver, registerContextReceiveIpc } from "./context-receive.mjs";
import { executeContextSend } from "./context-send-core.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";
import { loadCoreSdk } from "./sdk.mjs";

const load = name => import(pathToFileURL(path.join(developmentRuntimeDir, "node_modules/sealbridge/dist", name)).href);
const sdk = await loadCoreSdk(path.join(developmentRuntimeDir, "node_modules/sealbridge"));
const core = await load("packages/core/dist/index.js");
const relayApi = await load("packages/relay/dist/index.js");
const input = "DW2_INPUT_" + "TRANSIENT_MARKER" + "x".repeat(4100);
const answer = "DW2_ANSWER_" + "TRANSIENT_MARKER";
const draft = { selectors: ["$"], fieldsAllowed: [], fieldsDenied: [], angle: "可否だけ", body: input, deliveryMode: "view_only", lifetimeHours: 24 };

async function bytes(dir) {
  return Buffer.concat(await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    const file = path.join(dir, entry.name);
    try { return entry.isDirectory() ? bytes(file) : await readFile(file); }
    catch (error) { if (error.code === "ENOENT") return Buffer.alloc(0); throw error; }
  })));
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = check();
    if (value) return value;
    await delay(20);
  }
  throw new Error("FIXTURE_WAIT_TIMEOUT");
}
function connect(store, peer, relay) {
  const requestId = crypto.randomUUID(), requestDigest = core.digest({ requestId });
  store.recordOutgoing({ peerOwnerDid: peer.did, peerAgentDid: peer.did, relayUrl: relay,
    outgoing: { requestId, requestDigest, ownerConsentDigest: requestDigest, createdAt: Date.now(), expiresAt: Date.now() + 86400000 } });
  store.applyAccepted({ peerOwnerDid: peer.did, requestId, requestDigest, connectionId: crypto.randomUUID(), remoteAcceptanceDigest: requestDigest });
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "dw2-receive-"));
  await mkdir(path.join(dir, "context-audits"));
  const relay = await relayApi.startLocalRelay();
  const owner = sdk.generateKeyPair(), sender = sdk.generateKeyPair();
  const identityOptions = { env: { SEALBRIDGE_DATA_DIR: dir } };
  const store = new sdk.WorkerTrustStore(owner, { path: sdk.workerIntakePath(owner.did, identityOptions) });
  connect(store, sender, relay.url);
  const events = [], sending = new Set();
  const controller = new AbortController();
  const receiver = createContextReceiver({ sdk, owner, signApproval: sdk.signApproval, identityOptions, dataDir: dir,
    auditPath: path.join(dir, "context-audits", "receive.jsonl"), relay: relay.url, send: event => events.push(event),
    workerOptions: { allowPrivateRelay: true, ...options.workerOptions }, reviewOptions: options.reviewOptions,
    enableRedelegation: options.enableRedelegation !== false });
  t.after(async () => { controller.abort(); receiver.stop(); await Promise.allSettled([...sending, running]); await relay.close(); await rm(dir, { recursive: true, force: true }); });
  const running = receiver.worker.start();
  running.catch(() => {});
  const send = (overrides = {}) => {
    const result = executeContextSend({ sdk, owner: sender, signApproval: sdk.signApproval,
    draft: { ...draft, deliveryMode: options.mode ?? draft.deliveryMode }, signal: controller.signal, target: { peerOwnerDid: owner.did, relayUrl: relay.url },
    auditPath: path.join(dir, "context-audits", "send.jsonl"), identityOptions,
    ask: async () => true, send: event => events.push(event),
    clientOptions: { allowPrivateRelay: true, timeoutMs: 15000,
      protocolPeers: { floor: () => "0.2.0", observe: () => {}, observePolicy: value => value }, ...overrides } });
    sending.add(result);
    void result.finally(() => sending.delete(result)).catch(() => {});
    return result;
  };
  return { dir, receiver, events, send, running, sender, owner, relay };
}

test("receive launcher refuses missing audit before spawning", () => {
  let calls = 0;
  for (const auditPath of [undefined, "relative", path.join(tmpdir(), "wrong.jsonl")]) {
    assert.throws(() => launchContextReceive({ dataDir: tmpdir(), auditPath,
      spawnChild: () => calls++ }), /AUDIT_PATH_REQUIRED/);
  }
  assert.equal(calls, 0);
});

for (const mode of ["view_only", "hand_over"]) test(`rules → explicit open → manual answer → ${mode} delivery records bilateral CONTEXT events`, { timeout: 30000 }, async t => {
  const { dir, receiver, events, send } = await fixture(t, { mode });
  assert.equal(receiver.command({ type: "open", id: "before-request" }), false);
  const result = send();
  result.catch(() => {});
  const row = await waitFor(() => {
    const rows = receiver.rows();
    if (rows.some(item => item.inspectionStatus === "error")) throw new Error("BUNDLED_RULE_INSPECTOR_FAILED:" + rows.find(item => item.inspectionStatus === "error").inspection?.diagnostics?.join(","));
    return rows.find(item => item.canOpen);
  });
  assert.equal(row.inspectionStatus, "complete");
  assert.equal(row.state, "reviewable");
  assert.equal(row.preview.length, 4000);
  assert.ok(row.preview === input.slice(0, 4000));
  assert.ok(row.summary);
  assert.equal(receiver.command({ type: "open", id: row.id }), true);
  assert.equal(receiver.command({ type: "open", id: row.id }), false);
  const compose = await waitFor(() => events.find(event => event.type === "compose"));
  assert.equal(JSON.stringify(compose).includes(input), false);
  assert.equal(receiver.command({ type: "reply", id: compose.id, body: answer }), true);
  assert.equal((await result).deliverable, answer);
  for (const name of ["send.jsonl", "receive.jsonl"]) {
    const audit = await readFile(path.join(dir, "context-audits", name), "utf8");
    for (const type of ["CONTEXT_GRANT", "CONTEXT_MODE", "CONTEXT_OPENED", "CONTEXT_DELETION_ATTEMPTED"]) assert.ok(audit.includes(type), type);
    assert.equal(audit.includes(input), false);
    assert.equal(audit.includes(answer), true);
  }
  assert.equal((await bytes(dir)).includes(Buffer.from(input)), false);
  const retained = [];
  for (const file of await readdir(path.join(dir, "context-audits"))) {
    const content = await readFile(path.join(dir, "context-audits", file));
    if (content.includes(Buffer.from(answer))) retained.push(file);
  }
  assert.deepEqual(retained.sort(), ["receive.jsonl", "receive.jsonl.tasks.jsonl", "send.jsonl"]);
  t.diagnostic("Bundled core retains output in both bilateral audits and its signed worker task checkpoint; Desktop writes no output file.");
  for (const entry of await readdir(dir)) {
    if (entry === "context-audits") continue;
    const location = path.join(dir, entry);
    const stat = await import("node:fs/promises").then(fs => fs.stat(location));
    const content = stat.isDirectory() ? await bytes(location) : await readFile(location);
    assert.equal(content.includes(Buffer.from(answer)), false);
  }
});

for (const status of ["error", "unavailable"]) test(`inspection ${status} stays held and never prompts approval`, { timeout: 20000 }, async t => {
  const { receiver, send } = await fixture(t, { reviewOptions: { provider: {
    async inspect(_envelope, context) { return { ownerDid: context.owner.did, contentDigest: context.contentDigest,
      envelopeDigest: context.envelopeDigest, kind: context.kind, status }; },
  } } });
  const result = send();
  await assert.rejects(result, error => error.code === "PENDING_OWNER_APPROVAL");
  const [row] = receiver.rows();
  assert.equal(row.inspectionStatus, status);
  assert.equal(row.canOpen, false);
  assert.equal(receiver.command({ type: "open", id: row.id }), false);
  assert.equal(row.preview.length, 4000);
  assert.ok(row.preview === input.slice(0, 4000));
  assert.equal(row.summary, undefined);
  assert.equal(receiver.command({ type: "discard", id: row.id }), true);
});

test("discard rejects live contract without running the manual adapter", { timeout: 20000 }, async t => {
  const { receiver, send, events } = await fixture(t);
  const result = send();
  result.catch(() => {});
  const row = await waitFor(() => {
    const rows = receiver.rows();
    if (rows.some(item => item.inspectionStatus === "error")) throw new Error("BUNDLED_RULE_INSPECTOR_FAILED:" + rows.find(item => item.inspectionStatus === "error").inspection?.diagnostics?.join(","));
    return rows.find(item => item.canOpen);
  });
  receiver.command({ type: "discard", id: row.id });
  await assert.rejects(result);
  assert.equal(events.some(event => event.type === "compose"), false);
});

test("approval redelegation is rejected by the bundled worker without a delegation facility", { timeout: 15000 }, async t => {
  const { receiver, owner, sender, relay, events } = await fixture(t, { enableRedelegation: false });
  const manifest = sdk.buildTaskManifest({ ownerDid: sender.did, workerDid: owner.did, protocolVersion: "0.2.0",
    title: "fixture", description: "fixture", contextGrant: { selectors: ["$"], angle: "可否", deliveryMode: "approval_redelegation" } });
  const envelope = core.signEnvelope({ taskId: manifest.taskId, recipientDid: owner.did, seq: 0, eventType: "PROPOSE",
    payload: { proposal: core.signPayload(manifest, sender), input, capabilityChains: [] } }, sender, { encrypt: true });
  const client = new relayApi.HttpRelayClient(relay.url, { allowPrivateRelay: true });
  await client.send(envelope);
  const rejected = await waitFor(() => events.find(event => event.type === "rejected"));
  assert.equal(rejected.code, "DELEGATION_INVALID");
  assert.equal(receiver.rows().some(row => row.canOpen), false);
  assert.equal(events.some(event => event.type === "compose"), false);
});

test("worker wait timeout retains quarantine and invalidates a late opening", { timeout: 15000 }, async t => {
  const { receiver, send } = await fixture(t, { workerOptions: { waitTimeoutMs: 1500 } });
  const result = send({ waitTimeoutMs: 2500 });
  await assert.rejects(result, error => {
    t.diagnostic(`Timeout code: ${error.code ?? "none"}; type: ${error.name}; message: ${error.message}`);
    return /TIMEOUT|INTERRUPTED/.test(error.code ?? error.message);
  });
  const [row] = receiver.rows();
  assert.ok(row);
  assert.equal(row.canOpen, false);
  assert.equal(receiver.command({ type: "open", id: row.id }), false);
});

test("production receive child refuses to start without audit, with no stderr", { timeout: 10000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw2-child-audit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./context-receive-child.mjs", import.meta.url))], {
    env: { ...sanitizedEnvironment(process.env, dir), SEALBRIDGE_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let output = "", stderr = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  child.stdin.write('{"type":"start"}\n');
  await closed;
  assert.deepEqual(JSON.parse(output), { type: "failed" });
  assert.equal(stderr, "");
  assert.equal((await readdir(dir)).length, 0);
});

test("sender distinguishes pending from timeouts", () => {
  assert.equal(contextSendFailureState({ code: "PENDING_OWNER_APPROVAL" }), "pending");
  assert.equal(contextSendFailureState(new Error("PEER_WAIT_TIMEOUT")), "timed-out");
  assert.equal(contextSendFailureState({ code: "TASK_INTERRUPTED" }), "timed-out");
  assert.equal(contextSendFailureState(new Error("OWNER_DENIED")), "failed");
});

test("receiver projects interrupted handshakes without forwarding diagnostics", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "receive-interrupted-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let onEvent;
  const events = [];
  createContextReceiver({ sdk: { ...sdk, WorkerNode: class {
    constructor(options) { onEvent = options.onEvent; }
  } }, owner: sdk.generateKeyPair(), signApproval: sdk.signApproval,
  identityOptions: { env: { SEALBRIDGE_DATA_DIR: dir } }, dataDir: dir,
  auditPath: path.join(dir, "context-audits", "receive.jsonl"), relay: "ws://127.0.0.1:1",
  enableRedelegation: false, send: event => events.push(event) });
  for (const phase of ["OWNER_APPROVAL", "ACCEPT_ACK_WAIT"]) {
    onEvent("INTERRUPTED", "task", { code: "TASK_INTERRUPTED", phase, detail: "private diagnostic" });
    assert.deepEqual(events.pop(), { type: "rejected", taskId: "task", code: "TASK_INTERRUPTED" });
  }
  onEvent("REJECTED", "task", { code: "OWNER_DENIED" });
  assert.deepEqual(events.pop(), { type: "rejected", taskId: "task", code: "OWNER_DENIED" });
});

test("main retains projections and correlates live decisions through local-only IPC", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw2-main-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => child.emit("close", 0);
  const messages = [];
  child.stdin.on("data", chunk => messages.push(JSON.parse(chunk.toString())));
  const receiver = createDesktopReceiver({ dataDir: dir, runtimeDir: dir, launch: () => child });
  t.after(() => receiver.stop());
  assert.deepEqual(receiver.action("early", "open"), { ok: false });
  await receiver.start();
  const emit = event => child.stdout.write(JSON.stringify(event) + "\n");
  emit({ type: "ready" });
  emit({ type: "rows", rows: [{ id: "held", taskId: "task", canOpen: true, inspectionStatus: "complete", state: "reviewable", preview: input.slice(0, 4000) }] });
  const handlers = new Map(), guarded = [];
  registerContextReceiveIpc({ receiver, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (channel, action) => { guarded.push(channel); return action; } });
  assert.equal(guarded.length, 5);
  assert.deepEqual(handlers.get("sealbridge:receive-action")(null, "held", "open"), { ok: true });
  assert.deepEqual(receiver.action("held", "open"), { ok: false });
  emit({ type: "compose", id: 3, taskId: "task", input });
  assert.equal(JSON.stringify(receiver.status().compose).includes(input), false);
  assert.deepEqual(receiver.reply(2, answer), { ok: false });
  assert.deepEqual(receiver.reply(3, answer), { ok: true });
  assert.deepEqual(receiver.reply(3, answer), { ok: false });
  assert.ok(messages[0].auditPath.startsWith(path.join(dir, "context-audits") + path.sep));
  assert.equal(messages.some(message => message.type === "open"), true);
  assert.ok(messages.at(-1).body === answer);
  child.stderr.write(input + answer);
  assert.equal(JSON.stringify(receiver.status()).includes(answer), false);
  assert.equal((await bytes(dir)).includes(Buffer.from(input)), false);
  assert.equal((await bytes(dir)).includes(Buffer.from(answer)), false);
});

test("inspection deadline produces error and never an opening decision", { timeout: 15000 }, async t => {
  const { receiver, send } = await fixture(t, { reviewOptions: { inspectionTimeoutMs: 30,
    provider: { inspect: () => new Promise(() => {}) } } });
  await assert.rejects(send(), error => error.code === "PENDING_OWNER_APPROVAL");
  const [row] = receiver.rows();
  assert.equal(row.inspectionStatus, "error");
  assert.equal(row.canOpen, false);
  assert.equal(receiver.command({ type: "open", id: row.id }), false);
});
