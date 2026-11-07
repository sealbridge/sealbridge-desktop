import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { buildNarrowedManifest, createContextReceiver } from "./context-receive-core.mjs";
import { executeContextSend } from "./context-send-core.mjs";
import { shortDid } from "./context-send-approval.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";

const load = name => import(pathToFileURL(path.join(developmentRuntimeDir, "node_modules/sealbridge/dist", name)).href);
const sdk = await load("cli/dist/sdk.js");
const core = await load("packages/core/dist/index.js");
const relayApi = await load("packages/relay/dist/index.js");
const marker = "DW4_PARENT_" + "TRANSIENT_MARKER";
const answer = "DW4_ANSWER_" + "TRANSIENT_MARKER";
const parentBody = `keep\n${marker}`;

async function bytes(dir) {
  return Buffer.concat(await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    const file = path.join(dir, entry.name);
    try { return entry.isDirectory() ? bytes(file) : await readFile(file); }
    catch (error) { if (error.code === "ENOENT") return Buffer.alloc(0); throw error; }
  })));
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 750; attempt++) {
    const value = check();
    if (value) return value;
    await delay(20);
  }
  throw new Error("FIXTURE_WAIT_TIMEOUT:" + label);
}
function connect(store, peer, relay) {
  const requestId = crypto.randomUUID(), requestDigest = core.digest({ requestId });
  store.recordOutgoing({ peerOwnerDid: peer.did, peerAgentDid: peer.did, relayUrl: relay,
    outgoing: { requestId, requestDigest, ownerConsentDigest: requestDigest, createdAt: Date.now(), expiresAt: Date.now() + 86400000 } });
  store.applyAccepted({ peerOwnerDid: peer.did, requestId, requestDigest, connectionId: crypto.randomUUID(), remoteAcceptanceDigest: requestDigest });
}

async function parties(t) {
  const root = await mkdtemp(path.join(tmpdir(), "dw4-redelegation-"));
  const dirs = {};
  for (const name of ["a", "b", "c"]) {
    dirs[name] = path.join(root, name);
    // mkdtemp is private. A nested party directory must be too, or Linux rejects the intake store.
    await mkdir(dirs[name], { mode: 0o700 });
    await mkdir(path.join(dirs[name], "context-audits"), { mode: 0o700 });
  }
  const relay = await relayApi.startLocalRelay();
  const keys = { a: sdk.generateKeyPair(), b: sdk.generateKeyPair(), c: sdk.generateKeyPair() };
  const identity = name => ({ env: { SEALBRIDGE_DATA_DIR: dirs[name] } });
  const storeB = new sdk.WorkerTrustStore(keys.b, { path: sdk.workerIntakePath(keys.b.did, identity("b")) });
  connect(storeB, keys.a, relay.url);
  connect(storeB, keys.c, relay.url);
  const storeC = new sdk.WorkerTrustStore(keys.c, { path: sdk.workerIntakePath(keys.c.did, identity("c")) });
  connect(storeC, keys.b, relay.url);
  const events = { b: [], c: [] }, cards = [], sendEvents = [];
  const controller = new AbortController();
  const receiver = name => createContextReceiver({ sdk, owner: keys[name], signApproval: core.signApproval,
    identityOptions: identity(name), dataDir: dirs[name], auditPath: path.join(dirs[name], "context-audits", "receive.jsonl"),
    relay: relay.url, send: event => events[name].push(event), workerOptions: { allowPrivateRelay: true } });
  const b = receiver("b"), c = receiver("c");
  const running = [b.worker.start(), c.worker.start()];
  for (const job of running) job.catch(() => {});
  const sending = new Set();
  t.after(async () => {
    controller.abort(); b.stop(); c.stop();
    await Promise.allSettled([...running, ...sending]);
    await relay.close();
    await rm(root, { recursive: true, force: true });
  });
  const send = () => {
    const result = executeContextSend({ sdk, owner: keys.a, signApproval: core.signApproval,
      draft: { selectors: ["one", "two"], fieldsAllowed: ["x", "y"], fieldsDenied: ["private"], angle: "可否",
        body: parentBody, deliveryMode: "approval_redelegation", lifetimeHours: 24 },
      signal: controller.signal, target: { peerOwnerDid: keys.b.did, relayUrl: relay.url },
      auditPath: path.join(dirs.a, "context-audits", "send.jsonl"), identityOptions: identity("a"),
      ask: async card => { cards.push(card); return true; }, send: event => sendEvents.push(event),
      clientOptions: { allowPrivateRelay: true, timeoutMs: 60000,
        protocolPeers: { floor: () => "0.2.0", observe() {}, observePolicy: policy => policy } } });
    sending.add(result);
    void result.finally(() => sending.delete(result)).catch(() => {});
    return result;
  };
  return { dirs, keys, b, c, events, cards, sendEvents, send };
}

test("approval preparation stays at depth 1 and an equal child extract never becomes a manifest", () => {
  const a = sdk.generateKeyPair(), b = sdk.generateKeyPair(), c = sdk.generateKeyPair();
  const parent = sdk.buildTaskManifest({ ownerDid: a.did, workerDid: b.did, title: "持ち寄り", description: "持ち寄り",
    protocolVersion: "0.2.0", contextGrant: { selectors: ["one", "two"], fieldsAllowed: ["x", "y"], fieldsDenied: ["private"],
      angle: "可否", deliveryMode: "approval_redelegation" } });
  assert.equal(parent.permissions.maxDelegationDepth, 1);
  const same = { sdk, ownerDid: b.did, peer: { peerOwnerDid: c.did }, parent, selectors: ["one", "two"],
    fieldsAllowed: ["x", "y"], fieldsDenied: ["private"], angle: "可否", body: parentBody, discloseRoot: false };
  assert.throws(() => buildNarrowedManifest(same), /DELEGATION_INVALID/);
  const child = buildNarrowedManifest({ ...same, selectors: ["one"], fieldsAllowed: ["x"], angle: "可否の一部", body: "keep" });
  assert.equal(child.permissions.maxDelegationDepth, 0);
  assert.equal(child.contextGrant.deliveryMode, "view_only");
  assert.equal(child.contextGrant.inputRetentionAllowed, false);
  assert.equal(child.contextGrant.retention, "ephemeral_view");
  assert.equal(JSON.stringify(child).includes(a.did), false);
  assert.throws(() => buildNarrowedManifest({ ...same, selectors: ["one"], fieldsAllowed: ["x"], body: a.did }), /DELEGATION_INVALID/);
  for (const file of ["context-receive-core.mjs", "context-send-core.mjs", "context-send.mjs", "context-receive.mjs"]) {
    assert.equal(readFileSync(new URL(`./${file}`, import.meta.url), "utf8").includes("pendingStore"), false);
  }
});

test("A approves a narrowed hop through B to C and sees C", { timeout: 90000 }, async t => {
  const { dirs, keys, b, c, events, cards, sendEvents, send } = await parties(t);
  const result = send();
  result.catch(() => {});
  const row = await waitFor(() => b.rows().find(item => item.canOpen && item.summary?.mode === "approval_redelegation"), "b-open");
  assert.equal(b.command({ type: "decide", id: 1, accept: true }), false);
  assert.equal(b.command({ type: "open", id: row.id }), true);
  const form = await waitFor(() => events.b.find(event => event.type === "redelegation"), "b-form");
  const recipient = form.recipients.find(item => item.did === shortDid(keys.c.did));
  assert.ok(recipient);
  assert.equal(JSON.stringify(form.recipients).includes(keys.a.did), false);
  assert.equal(b.command({ type: "decide", id: 1, accept: true }), false);
  assert.equal(b.command({ type: "narrow", id: form.id, recipientId: recipient.id, selectors: ["one"], fieldsAllowed: ["x"],
    fieldsDenied: ["private"], angle: "可否の一部", body: "keep", discloseRoot: false }), true);
  const redelegation = await waitFor(() => events.b.find(event => event.type === "approval" && event.card?.gate === "redelegation"), "b-card");
  assert.equal(redelegation.card.discloseRoot, false);
  assert.equal(redelegation.card.depthRemaining, 0);
  assert.ok(redelegation.card.droppedSelectors.includes("two"));
  assert.ok(redelegation.card.droppedFields.includes("y"));
  assert.equal(redelegation.card.recipient, shortDid(keys.c.did));
  assert.equal(b.command({ type: "decide", id: redelegation.id, accept: true }), true);
  const childRow = await waitFor(() => c.rows().find(item => item.canOpen && item.summary?.mode === "view_only"), "c-open");
  assert.equal(childRow.preview, "keep");
  assert.equal(JSON.stringify(events.c).includes(keys.a.did), false);
  assert.equal(JSON.stringify(events.c).includes(marker), false);
  assert.equal(events.c.some(event => event.type === "redelegation"), false);
  assert.equal(c.command({ type: "open", id: childRow.id }), true);
  const compose = await waitFor(() => events.c.find(event => event.type === "compose"), "c-compose");
  assert.equal(JSON.stringify(compose).includes(keys.a.did), false);
  assert.equal(JSON.stringify(compose).includes(marker), false);
  assert.equal(c.command({ type: "reply", id: compose.id, body: answer }), true);
  const finalCard = await waitFor(() => events.b.find(event => event.type === "approval" && event.card?.gate === "final_verification"), "b-final");
  assert.ok(String(finalCard.card.deliverable).includes(answer));
  assert.equal(b.command({ type: "decide", id: finalCard.id, accept: true }), true);
  const settled = await result;
  assert.equal(settled.state, "SETTLED");
  assert.equal(settled.deliverable, answer);
  const delivery = settled.bundle.entries.find(entry => entry.body.eventType === "DELIVER").body.payload;
  assert.deepEqual(sdk.verifyDelegationAttachment(delivery.delegation, delivery.delegation.parentContract).delegateeOwnerDids, [keys.c.did]);
  const child = delivery.delegation.children[0].childContract.manifest;
  assert.equal(child.permissions.maxDelegationDepth, 0);
  assert.equal(child.contextGrant.deliveryMode, "view_only");
  assert.equal(child.contextGrant.inputRetentionAllowed, false);
  assert.equal(JSON.stringify(child).includes(keys.a.did), false);
  const rootFinal = cards.filter(card => card.gate === "final_verification");
  assert.equal(rootFinal.length, 1);
  assert.deepEqual(rootFinal[0].delegateeOwnerDids, [shortDid(keys.c.did)]);
  assert.deepEqual(sendEvents.find(event => event.type === "result").delegateeOwnerDids, [keys.c.did]);
  for (const dir of Object.values(dirs)) {
    assert.equal((await bytes(dir)).includes(Buffer.from(marker)), false);
    const names = JSON.stringify(await readdir(dir, { recursive: true }));
    assert.equal(/pending-store|pendingStore|context-redelegation/.test(names), false);
  }
  assert.equal((await bytes(dirs.c)).includes(Buffer.from(keys.a.did)), false);
  assert.equal(JSON.stringify(events.c).includes(marker), false);
});

test("an equal child extract is refused before C is asked", { timeout: 90000 }, async t => {
  const { keys, b, c, events, send } = await parties(t);
  const result = send();
  result.catch(() => {});
  const row = await waitFor(() => b.rows().find(item => item.canOpen), "b-open");
  assert.equal(b.command({ type: "open", id: row.id }), true);
  const form = await waitFor(() => events.b.find(event => event.type === "redelegation"), "b-form");
  const recipient = form.recipients.find(item => item.did === shortDid(keys.c.did));
  assert.equal(b.command({ type: "narrow", id: form.id, recipientId: recipient.id, selectors: ["one", "two"],
    fieldsAllowed: ["x", "y"], fieldsDenied: ["private"], angle: "可否", body: parentBody, discloseRoot: false }), true);
  const rejected = await waitFor(() => events.b.find(event => event.type === "rejected"), "b-rejected");
  assert.equal(rejected.code, "DELEGATION_INVALID");
  await assert.rejects(result, error => /DELEGATION_INVALID/.test(`${error.code ?? ""} ${error.message}`));
  assert.equal(events.b.some(event => event.type === "approval" && event.card?.gate === "redelegation"), false);
  assert.equal(c.rows().some(item => item.canOpen), false);
  assert.equal(events.c.some(event => event.type === "compose" || event.type === "redelegation"), false);
  assert.equal(JSON.stringify(events.c).includes(marker), false);
});
