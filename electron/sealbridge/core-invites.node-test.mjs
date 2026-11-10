import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCoreSdk } from "./sdk.mjs";
import { createCoreInvites } from "./core-invites.mjs";
import { bootstrapCore, resolveCoreContext } from "./bootstrap.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";

const packageDir = path.join(developmentRuntimeDir, "node_modules/sealbridge");

async function allBytes(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const buffers = await Promise.all(entries.map(entry => entry.isDirectory()
    ? allBytes(path.join(dir, entry.name)) : readFile(path.join(dir, entry.name))));
  return Buffer.concat(buffers);
}

test("pinned core imports into OS secret store, keeps DID, confirms only limited intent and deletes cancelled credentials", async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sealbridge-g4-core-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const secrets = new Map(), frames = [], mcp = [];
  const keyringLoader = async () => ({ Entry: class {
    constructor(service, account) { this.id = service + "/" + account; }
    getPassword() { return secrets.get(this.id) ?? null; }
    setPassword(value) { secrets.set(this.id, value); }
    deletePassword() { secrets.delete(this.id); }
  } });
  const options = { packageDir, dataDir, keyringLoader, connectionOptions: {
    transportFactory: () => ({ send: async frame => { frames.push(frame); }, receive: async () => [] }),
  } };
  const core = await loadCoreSdk(packageDir);
  const runtime = core;
  const first = await bootstrapCore(options);
  const peer = core.generateKeyPair();
  const agentCard = core.createSignedAgentCard({ name: "G4 fixture peer", agentDid: peer.did,
    relayEndpoint: "https://relay.sealbridge.dev", skills: [], protocolVersions: ["0.2.0"] }, peer);
  const token = core.createInviteToken({ agentCard, expiresInSeconds: 3600 }, peer);
  const api = await createCoreInvites(options);
  const preview = api.import(token);
  assert.equal(preview.owned, true);
  assert.equal(api.import(token).owned, false);
  const otherPeer = core.generateKeyPair();
  const otherCard = core.createSignedAgentCard({ name: "G4 fixture peer", agentDid: otherPeer.did,
    relayEndpoint: "https://relay.sealbridge.dev", skills: [], protocolVersions: ["0.2.0"] }, otherPeer);
  const otherToken = core.createInviteToken({ agentCard: otherCard, expiresInSeconds: 3600 }, otherPeer);
  const otherPreview = api.import(otherToken);
  assert.deepEqual(otherPreview.warnings, ["same-name-different-did"]);
  assert.deepEqual(preview.warnings, []);
  const renamedCard = core.createSignedAgentCard({ name: "Changed fixture", agentDid: peer.did,
    relayEndpoint: "https://relay.sealbridge.dev", skills: [], protocolVersions: ["0.2.0"] }, peer);
  const renamedPreview = api.import(core.createInviteToken({ agentCard: renamedCard, expiresInSeconds: 3600 }, peer));
  assert.deepEqual(renamedPreview.warnings, ["identity-changed"]);
  api.remove(renamedPreview.workerRef);
  api.remove(otherPreview.workerRef);
  assert.equal(frames.length, 0);
  assert.ok([...secrets.values()].includes(token));
  const { owner, identityOptions } = await resolveCoreContext(options);
  const trust = new runtime.WorkerTrustStore(owner, { path: runtime.workerIntakePath(owner.did, identityOptions) });
  assert.equal(trust.connectionState(peer.did), "none");
  mcp.push(await first.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "acp_list_invites", arguments: {} } }));
  assert.deepEqual(await api.confirm(preview.workerRef), { state: "pending-connection" });
  assert.equal(frames.length, 1);
  assert.equal(trust.connectionState(peer.did), "pending");
  assert.equal(trust.connectionLevel(peer.did), "unknown");
  assert.equal(trust.hasExplicitLegacyGrant(peer.did), false);
  const second = await bootstrapCore(options);
  assert.equal(first.did, second.did);
  assert.deepEqual(api.remove(preview.workerRef), { removed: true });
  assert.ok(![...secrets.values()].includes(token));
  const changedAgent = core.generateKeyPair();
  const changedAgentCard = core.createSignedAgentCard({ name: "G4 fixture peer", agentDid: changedAgent.did,
    relayEndpoint: "https://relay.sealbridge.dev", skills: [], protocolVersions: ["0.2.0"] }, peer, changedAgent);
  const changedAgentToken = core.createInviteToken({ agentCard: changedAgentCard, expiresInSeconds: 3600 }, peer);
  const changedPreview = api.import(changedAgentToken);
  assert.deepEqual(changedPreview.warnings, ["identity-changed"]);
  api.remove(changedPreview.workerRef);
  assert.ok(!(await allBytes(dataDir)).includes(Buffer.from(token)));
  assert.ok(!JSON.stringify([preview, frames, mcp]).includes(token));
  assert.ok(!(await allBytes(dataDir)).includes(Buffer.from('"d":')));
});
