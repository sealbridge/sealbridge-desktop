import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopPrefs } from "./desktop-prefs.mjs";
import { createWorkplaces, createWorkplacePort, parseWorkplace, registerWorkplaceIpc } from "./sealbridge/workplace.mjs";

const agent = `did:key:z${"a".repeat(48)}`;
const definition = { id: "fixture", name: "任意の作業場", executable: process.execPath, cwd: tmpdir(), args: [], versionArgs: ["--version"], scopeArgs: ["--read-only"], scopeDescription: "fixture scope", noRecordArgs: ["--no-history"], stdin: "text-eof", stop: "terminate", retention: "unknown" };
function setup(options = {}) {
  let stored;
  const prefs = createDesktopPrefs({ read: () => stored, write: value => { stored = structuredClone(value); } });
  const calls = [];
  let child;
  const spawnChild = (exe, args, opts) => {
    calls.push(["spawn", exe, args, opts]);
    child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter() });
    return child;
  };
  const port = {
    find: async d => { calls.push(["find", d.id]); return process.execPath; },
    version: async () => { calls.push(["version"]); return "fixture 1"; },
    launchSpec: createWorkplacePort().launchSpec,
    stdin: async (_child, text) => { calls.push(["stdin", text]); },
    stop: async (_child, method, force) => { calls.push(["stop", method, force]); if (options.hang && !force) return false; child.emit("exit", 0); return true; },
    retention: createWorkplacePort().retention,
  };
  const app = createWorkplaces({ prefs, port, spawnChild, ...options });
  app.save(definition); app.select(agent, [definition.id]);
  return { app, calls, prefs, port, getStored: () => stored, getChild: () => child };
}
async function verified(app) {
  await app.test(definition.id);
  app.verify(definition.id, { scope: true, noRecord: true, stdin: true, stop: true });
}
const launch = (app, extra = {}) => app.prepare({ action: "launch", agent, id: definition.id, ...extra });

test("settings persist in existing preferences without executing or discovering; identity selection shares only definitions", () => {
  const { calls, prefs, getStored } = setup();
  prefs.setAnalytics(false);
  const restored = createDesktopPrefs({ read: getStored, write: () => {} });
  assert.equal(restored.workplaces().definitions[0].name, definition.name);
  assert.deepEqual(restored.workplaces().agents[agent], [definition.id]);
  assert.deepEqual(calls, []);
  assert.equal(restored.analytics(), false);
  assert.doesNotMatch(JSON.stringify(getStored()), /"(?:text|history|privateKey|inviteToken)":/);
});

test("every argument source rejects approval bypasses, including custom bindings", () => {
  for (const flag of ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--dangerously-bypass-approvals-and-sandbox", "danger-full-access", "Full access", "--yolo", "--permission-mode=bypassPermissions"]) {
    for (const field of ["args", "versionArgs", "scopeArgs", "noRecordArgs"]) assert.throws(() => parseWorkplace({ ...definition, [field]: [flag] }));
  }
});

test("launch needs selected identity, discovery and one-use owner decision, sends nothing and never restarts", async () => {
  const { app, calls, getChild } = setup();
  await assert.rejects(launch(app));
  await app.find(definition.id);
  await assert.rejects(app.prepare({ action: "launch", agent: "other", id: definition.id }));
  const cancelled = await launch(app); await app.decide(cancelled.id, false);
  assert.equal(calls.filter(c => c[0] === "spawn").length, 0);
  const card = await launch(app);
  assert.equal(card.level, 0); assert.equal(card.version, "未確認");
  await app.decide(card.id, true); await app.decide(card.id, true);
  assert.equal(calls.filter(c => c[0] === "spawn").length, 1);
  assert.equal(calls.filter(c => c[0] === "stdin").length, 0);
  assert.equal(calls.find(c => c[0] === "spawn")[3].shell, false);
  getChild().emit("exit", 1);
  getChild().emit("close", 1);
  assert.equal(app.status()[0].running, false);
  assert.equal(calls.filter(c => c[0] === "spawn").length, 1);
});

test("stage 1 cannot be enabled by editing settings; exact approved text travels only once via stdin", async () => {
  const { app, calls, getStored } = setup();
  await app.find(definition.id);
  await assert.rejects(launch(app, { level: 1 }));
  assert.throws(() => app.verify(definition.id, { scope: true }));
  await verified(app);
  const card = await launch(app, { level: 1, noRecord: true }); await app.decide(card.id, true);
  const text = "所有者の未送信の文\nスペース & $() ` ; \" 그대로";
  const pass = await app.prepare({ action: "pass", agent, id: definition.id, text, source: "owner-draft" });
  assert.equal(pass.text, text);
  await app.decide(pass.id, false);
  assert.equal(calls.filter(c => c[0] === "stdin").length, 0);
  const accepted = await app.prepare({ action: "pass", agent, id: definition.id, text, source: "owner-draft" });
  await app.decide(accepted.id, true); await app.decide(accepted.id, true);
  assert.deepEqual(calls.filter(c => c[0] === "stdin"), [["stdin", accepted.text]]);
  assert.ok(!JSON.stringify(calls.find(c => c[0] === "spawn")).includes(text));
  assert.ok(!JSON.stringify(getStored()).includes(text));
  await assert.rejects(app.prepare({ action: "pass", agent, id: definition.id, text, source: "owner-draft" }));
});

test("unstarted and stage 0 workplaces, expired or received origins and secrets cannot accept input", async () => {
  const { app } = setup(); await verified(app);
  const pass = source => app.prepare({ action: "pass", agent, id: definition.id, text: "fixture text", source });
  await assert.rejects(pass("owner-draft"));
  const zero = await launch(app); await app.decide(zero.id, true);
  await assert.rejects(pass("owner-draft"));
  const stop = await app.prepare({ action: "stop", agent, id: definition.id }); await app.decide(stop.id, true);
  const one = await launch(app, { level: 1 }); await app.decide(one.id, true);
  for (const source of ["received", "expired", "quarantined", "unchecked", "delivery"]) await assert.rejects(pass(source));
  await assert.rejects(app.prepare({ action: "pass", agent, id: definition.id, text: "privateKey=fixture-key", source: "owner-draft" }));
});

test("stop and force stop are independent decisions; no deletion claim; settings edits invalidate checks and approvals", async () => {
  const { app, calls } = setup({ hang: true }); await verified(app);
  const card = await launch(app); await app.decide(card.id, true);
  await assert.rejects(app.prepare({ action: "force", agent, id: definition.id }));
  const stop = await app.prepare({ action: "stop", agent, id: definition.id });
  assert.equal(calls.filter(c => c[0] === "stop").length, 0);
  await app.decide(stop.id, true);
  assert.equal(app.status()[0].running, true);
  assert.match(app.status()[0].notice, /一定時間/);
  const force = await app.prepare({ action: "force", agent, id: definition.id }); await app.decide(force.id, true);
  assert.equal(app.status()[0].running, false); assert.match(app.status()[0].notice, /消えません/);
  const stale = await launch(app); app.save({ ...definition, name: "changed" }); await app.decide(stale.id, true);
  assert.equal(calls.filter(c => c[0] === "spawn").length, 1);
  assert.deepEqual(app.settings().verified, {});
});

test("expired decisions and redaction of chunked output", async () => {
  let now = 0;
  const { app, calls, getChild } = setup({ now: () => now }); await app.find(definition.id);
  const expired = await launch(app); now = 120001; await assert.rejects(app.decide(expired.id, true));
  assert.equal(calls.filter(c => c[0] === "spawn").length, 0);
  const card = await launch(app); await app.decide(card.id, true);
  getChild().stdout.emit("data", Buffer.from("privateK"));
  assert.equal(app.status()[0].output, "");
  getChild().stdout.emit("data", Buffer.from("ey=fixture-secret\n"));
  assert.match(app.status()[0].output, /REDACTED/); assert.doesNotMatch(app.status()[0].output, /fixture-secret/);
});

test("IPC is local-only for every fixed operation", () => {
  const handlers = new Map(), guarded = [];
  registerWorkplaceIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, localOnly: (key, fn) => { guarded.push(key); return fn; }, workplaces: {} });
  assert.equal(handlers.size, 10); assert.equal(guarded.length, 10);
  const { app } = setup();
  assert.equal(app.validateOwnerText("privateKey=fixture-secret"), false);
  assert.equal(app.validateOwnerText("acp-invite:fixture-secret"), false);
  assert.equal(app.validateOwnerText("自分の文"), true);
});

test("isolated real process: no launch text, exact stdin, redacted output, no prompt files, confirmed tree stop", { timeout: 20000 }, async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), "sealbridge-workplace-fixture-"));
  const script = fileURLToPath(new URL("./sealbridge/fixtures/fake-workplace.mjs", import.meta.url));
  const prefs = createDesktopPrefs({ read: () => null, write: () => {} });
  const app = createWorkplaces({ prefs });
  t.after(async () => { await app.stopAll(true); await rm(cwd, { recursive: true, force: true }); });
  app.save({ ...definition, cwd, args: [script, "--fixture-grandchild"], versionArgs: [script, "--fixture-version"] }); app.select(agent, [definition.id]); await verified(app);
  const before = await readdir(cwd);
  const card = await launch(app, { level: 1, noRecord: true }); await app.decide(card.id, true);
  const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 25)); } assert.fail("fixture condition timed out"); };
  await until(() => app.status()[0].output.includes("READY"));
  assert.doesNotMatch(app.status()[0].output, /RECEIVED/);
  const text = "自分の下書き\nexact EOF";
  const pass = await app.prepare({ action: "pass", agent, id: definition.id, text, source: "owner-draft" }); await app.decide(pass.id, true);
  await until(() => app.status()[0].output.includes("RECEIVED:"));
  assert.match(app.status()[0].output, new RegExp(`RECEIVED:${Buffer.from(pass.text).toString("base64")}`));
  assert.doesNotMatch(app.status()[0].output, /fixture-secret-key/);
  assert.deepEqual(await readdir(cwd), before);
  const stop = await app.prepare({ action: "stop", agent, id: definition.id }); await app.decide(stop.id, true);
  if (app.status()[0].running) { const force = await app.prepare({ action: "force", agent, id: definition.id }); await app.decide(force.id, true); }
  assert.equal(app.status()[0].running, false);
  const pids = [...app.status()[0].output.matchAll(/(?:PID|CHILD):(\d+)/g)].map(match => Number(match[1]));
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
