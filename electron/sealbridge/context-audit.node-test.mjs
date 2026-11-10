import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadCoreSdk } from "./sdk.mjs";
import { readFileSync } from "node:fs";
import { developmentRuntimeDir } from "./runtime.mjs";
import { auditFileName, deleteContextAudit, listContextAudits, projectAuditRecord, registerContextAuditIpc } from "./context-audit.mjs";

const input = "DW3_INPUT_MARKER";
const answer = "DW3_ANSWER_MARKER";
const digest = "sha256:" + "ab".repeat(32);

function bundle(mode, data = answer) {
  return { checkpoint: { actor: {} }, entries: [
    { body: { eventType: "PROPOSE", payload: { input, proposalDigest: digest, selectors: ["$.secret"] } } },
    { body: { eventType: "CONTEXT_GRANT", payload: { grantDigest: digest, deliveryMode: mode } } },
    { body: { eventType: "DELIVER", payload: { input, artifact: { payload: { type: "Artifact", data } } } } },
  ] };
}

test("audit reader shows only a verified hand-over artifact and drops selection text", () => {
  const shown = projectAuditRecord(bundle("hand_over"), () => ({ valid: true }));
  assert.equal(shown.verified, true);
  assert.equal(shown.deliveryMode, "hand_over");
  assert.equal(shown.deliverable, answer);
  assert.equal(shown.outputRetained, true);
  assert.equal(JSON.stringify(shown).includes(input), false);
  assert.equal(JSON.stringify(shown).includes(digest), false);
  assert.equal(JSON.stringify(shown).includes("selectors"), false);
  const viewed = projectAuditRecord(bundle("view_only"), () => ({ valid: true }));
  assert.equal(viewed.deliveryMode, "view_only");
  assert.equal(viewed.outputRetained, true);
  assert.equal(viewed.deliverable, undefined);
  assert.equal(JSON.stringify(viewed).includes(answer), false);
  assert.equal(JSON.stringify(viewed).includes(input), false);
  const rejected = projectAuditRecord(bundle("hand_over"), () => ({ valid: false }));
  assert.deepEqual(rejected, { verified: false, outputRetained: false });
  assert.equal(JSON.stringify(rejected).includes(answer), false);
  assert.deepEqual(projectAuditRecord(bundle("hand_over"), () => { throw new Error(input); }), rejected);
});

test("desktop audit module only reads and deletes files", () => {
  const source = readFileSync(new URL("./context-audit.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /appendFile|writeFile|createWriteStream|appendContextGrant|append\(/);
  for (const id of ["../x.jsonl", "a/b.jsonl", "note.jsonl.tasks.jsonl", "note.jsonl.errors.jsonl", ".jsonl", ""])
    assert.equal(auditFileName(id), null);
  assert.equal(auditFileName("11111111-1111-4111-8111-111111111111.jsonl"), "11111111-1111-4111-8111-111111111111.jsonl");
});

test("unverified and foreign files are not shown or deleted", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw3-audit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audits = path.join(dir, "context-audits");
  await mkdir(audits);
  const name = "11111111-1111-4111-8111-111111111111.jsonl";
  await writeFile(path.join(audits, name), input + answer);
  await writeFile(path.join(audits, name + ".tasks.jsonl"), answer);
  await mkdir(path.join(audits, "directory.jsonl"));
  const outside = path.join(dir, "outside.jsonl");
  await writeFile(outside, answer);
  const messages = [];
  for (const method of ["log", "warn", "error", "debug", "info"]) t.mock.method(console, method, (...args) => messages.push(args));
  const sdk = { parseAuditJsonl() { throw new Error(input); }, verifyAudit() { throw new Error(answer); } };
  const rows = await listContextAudits({ dataDir: dir, loadSdk: async () => sdk });
  assert.deepEqual(rows, [{ id: name, verified: false, outputRetained: false }, { id: "directory.jsonl", verified: false, outputRetained: false }]);
  assert.equal(JSON.stringify({ rows, messages }).includes(input), false);
  assert.equal(JSON.stringify({ rows, messages }).includes(answer), false);
  assert.deepEqual(await deleteContextAudit({ dataDir: dir, id: name + ".tasks.jsonl" }), { ok: false });
  assert.deepEqual(await deleteContextAudit({ dataDir: dir, id: "../outside.jsonl" }), { ok: false });
  assert.deepEqual(await deleteContextAudit({ dataDir: dir, id: "directory.jsonl" }), { ok: false });
  assert.equal(await readFile(path.join(audits, name + ".tasks.jsonl"), "utf8"), answer);
  assert.equal(await readFile(outside, "utf8"), answer);
  try { await symlink(outside, path.join(audits, "link.jsonl"), "file"); }
  catch { return; }
  const linked = (await listContextAudits({ dataDir: dir, loadSdk: async () => sdk })).find(row => row.id === "link.jsonl");
  assert.deepEqual(linked, { id: "link.jsonl", verified: false, outputRetained: false });
  assert.deepEqual(await deleteContextAudit({ dataDir: dir, id: "link.jsonl" }), { ok: false });
  assert.equal(await readFile(outside, "utf8"), answer);
});

test("audit IPC stays local and does not echo a failed verification", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw3-audit-ipc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audits = path.join(dir, "context-audits");
  await mkdir(audits);
  await writeFile(path.join(audits, "ipc.jsonl"), JSON.stringify({ input, answer }));
  const handlers = new Map();
  registerContextAuditIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    localOnly: (_key, fn) => (event, ...args) => { if (!event.local) throw new Error("remote"); return fn(event, ...args); },
    dataDir: dir, loadSdk: async () => ({ parseAuditJsonl(text) { assert.equal(text.includes(input), true); return bundle("hand_over"); },
      verifyAudit() { return { valid: false }; } }) });
  const rows = await handlers.get("sealbridge:received-audits")({ local: true });
  assert.deepEqual(rows, [{ id: "ipc.jsonl", verified: false, outputRetained: false }]);
  assert.equal(JSON.stringify(rows).includes(answer), false);
  assert.throws(() => handlers.get("sealbridge:received-audits")({ local: false }));
  assert.deepEqual(await handlers.get("sealbridge:received-audit-delete")({ local: true }, "ipc.jsonl"), { ok: true });
  await assert.rejects(readFile(path.join(audits, "ipc.jsonl")));
});

test("sealed audits keep output on disk, show hand-over only, and fail closed when changed", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "dw3-audit-seal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "context-audits"));
  const sdk = await loadCoreSdk(path.join(developmentRuntimeDir, "node_modules/sealbridge"));
  const handAnswer = "DW3_HAND_ANSWER";
  const viewAnswer = "DW3_VIEW_ANSWER";
  const calls = { parse: 0, verify: 0 };
  const wrapped = { parseAuditJsonl(text) { calls.parse += 1; return sdk.parseAuditJsonl(text); },
    verifyAudit(value) { calls.verify += 1; return sdk.verifyAudit(value); } };
  async function seal(mode, body) {
    const name = randomUUID() + ".jsonl";
    const file = path.join(dir, "context-audits", name);
    const requester = sdk.generateKeyPair(), worker = sdk.generateKeyPair();
    const taskId = "task_dw3audit01";
    const grant = sdk.buildContextGrant({ selectors: ["$"], angle: "可否", deliveryMode: mode, expiresAt: "2026-11-02T00:00:00.000Z" }, "2026-11-01T00:00:00.000Z");
    const ledger = new sdk.BilateralLedger(taskId, [requester.did, worker.did], new sdk.JsonlStore(file));
    const summary = sdk.contextGrantAuditPayload(grant);
    ledger.append("CONTEXT_GRANT", summary, requester, worker);
    ledger.append("PROPOSE", { ...summary, payloadDigest: digest, manifestDigest: digest, proposalDigest: digest, input }, requester, worker);
    ledger.append("DELIVER", { artifact: { payload: { type: "Artifact", taskId, name: "report.json", digest, data: body } } }, worker, requester);
    ledger.bundle(requester, worker);
    await writeFile(file + ".tasks.jsonl", body);
    return { name, file };
  }
  const handed = await seal("hand_over", handAnswer);
  const viewed = await seal("view_only", viewAnswer);
  const before = await readFile(handed.file);
  const rows = await listContextAudits({ dataDir: dir, loadSdk: async () => wrapped });
  assert.deepEqual(await readFile(handed.file), before);
  assert.equal(calls.parse >= 2 && calls.verify >= 2, true);
  const hand = rows.find(row => row.id === handed.name);
  const view = rows.find(row => row.id === viewed.name);
  assert.equal(hand.deliverable, handAnswer);
  assert.equal(hand.outputRetained, true);
  assert.equal(view.deliveryMode, "view_only");
  assert.equal(view.outputRetained, true);
  assert.equal(view.deliverable, undefined);
  const shown = JSON.stringify(rows);
  assert.equal(shown.includes(handAnswer), true);
  assert.equal(shown.includes(viewAnswer), false);
  assert.equal(shown.includes(input), false);
  assert.equal((await readFile(viewed.file, "utf8")).includes(viewAnswer), true);
  assert.equal((await readFile(viewed.file, "utf8")).includes(input), true);
  const tampered = (await readFile(handed.file, "utf8")).replace(/sha256:[a-f0-9]{64}/, match => match.slice(0, -1) + (match.endsWith("0") ? "1" : "0"));
  await writeFile(handed.file, tampered);
  const after = await listContextAudits({ dataDir: dir, loadSdk: async () => wrapped });
  const broken = after.find(row => row.id === handed.name);
  assert.deepEqual(broken, { id: handed.name, verified: false, outputRetained: false });
  assert.equal(JSON.stringify(after).includes(handAnswer), false);
  assert.equal(calls.verify > 2, true);
  assert.deepEqual(await deleteContextAudit({ dataDir: dir, id: viewed.name }), { ok: true });
  await assert.rejects(readFile(viewed.file));
  assert.equal(await readFile(viewed.file + ".tasks.jsonl", "utf8"), viewAnswer);
  assert.equal((await listContextAudits({ dataDir: dir, loadSdk: async () => wrapped })).some(row => row.id === viewed.name), false);
});
