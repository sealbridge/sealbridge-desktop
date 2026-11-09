import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview } from "./testing/preview-fixture.ts";
import { createDesktopPrefs } from "../electron/desktop-prefs.mjs";
import { createWorkplaces } from "../electron/sealbridge/workplace.mjs";
import { killTree } from "../electron/shared-computer-access.mjs";

const output = await mkdtemp(path.join(tmpdir(), "sealbridge-workplace-evidence-"));
const profile = path.join(output, "chrome-profile");
const fixture = await launchVerificationServer();
const workplaces = createWorkplaces({ prefs: createDesktopPrefs({ read: () => null, write: () => {} }) });
const agent = `did:key:z${"a".repeat(48)}`, id = "fixture";
let chrome, preview, ws;
const receipts = [], errors = [];
const until = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error("fixture condition timed out"); };
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "en" });
  const created = await runControlOmb(["new-bot", "--name", "WorkplaceFixture", "--url", fixture.info.url]);
  const bot = created.bot.id;
  receipts.push(await runControlOmb(["send", "--bot", bot, "--text", "Retained fixture conversation", "--url", fixture.info.url]));
  receipts.push(await runControlOmb(["wait", "--bot", bot, "--timeout", "30", "--url", fixture.info.url]));
  const before = await runControlOmb(["messages", "--bot", bot, "--limit", "10", "--url", fixture.info.url]);
  workplaces.save({ id, name: "任意の fixture 作業場", executable: process.execPath,
    args: [fileURLToPath(new URL("../electron/sealbridge/fixtures/fake-workplace.mjs", import.meta.url))], cwd: output,
    versionArgs: ["--version"], scopeArgs: ["--fixture-read-only"], scopeDescription: "fixture の範囲", noRecordArgs: ["--fixture-no-history"], stdin: "text-eof", stop: "terminate", retention: "unknown" });
  workplaces.select(agent, [id]);
  preview = await mountPreview(fixture, { entry: "/scripts/testing/workplace-preview.tsx", route: "/__workplace.html", title: "Isolated workplace", extraRoutes: [{ path: "/__workplace", method: "POST", handler: async (req, res) => {
    try {
      let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 131072) throw new Error("too large"); }
      const { method, args } = JSON.parse(body);
      if (!["settings", "save", "select", "find", "test", "verify", "status", "prepare", "decide", "validateOwnerText"].includes(method)) throw new Error("invalid operation");
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(await workplaces[method](...args) ?? null));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
  } }] });
  chrome = spawn(process.env.OMB_FIXTURE_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port;
  await until(async () => { try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return true; } catch { return false; } });
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let next = 0; const pending = new Map();
  ws.addEventListener("message", event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); if (p) { pending.delete(data.id); if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result); } } else if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const click = async text => { await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled)`)); await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`); };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url: `${preview.previewUrl}?bot=${bot}` });
  await until(() => evaluate(`document.querySelector('h1')?.textContent==='ホーム'`));
  assert.equal(workplaces.status().length, 0);
  assert.equal(await evaluate(`document.body.textContent.includes('作業場の設定')`), false);
  await click("受信箱で確認する");
  await until(() => evaluate(`document.querySelector('h1')?.textContent==='受信箱'`));
  await until(() => evaluate(`document.body.textContent.includes('相手の fixture')`));
  assert.equal(workplaces.status().length, 0);
  await click("ホーム"); await click("届け先の詳細");
  await click("Desktop 内の作業場を開く");
  await until(() => evaluate(`document.body.textContent.includes('Retained fixture conversation')`));
  assert.equal(workplaces.status().length, 0);
  const afterOpen = await runControlOmb(["messages", "--bot", bot, "--limit", "10", "--url", fixture.info.url]);
  assert.deepEqual(afterOpen, before);
  await click("ホーム"); await click("届け先の詳細");
  await click("任意の fixture 作業場 を起こす前に確認");
  await until(() => evaluate(`!!document.querySelector('[role=dialog]')`));
  assert.equal(workplaces.status().length, 0);
  assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('依頼の本文はまだ渡しません')`), true);
  await click("起こす");
  await until(() => workplaces.status()[0]?.output.includes("READY"));
  assert.doesNotMatch(workplaces.status()[0].output, /RECEIVED/);
  await click("任意の fixture 作業場 を止める前に確認"); await click("止める");
  await until(() => workplaces.status()[0]?.running === false || workplaces.status()[0]?.notice.includes("一定時間"));
  if (workplaces.status()[0].running) { await click("任意の fixture 作業場 の強制停止を確認"); await click("強制停止"); await until(() => !workplaces.status()[0].running); }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(path.join(output, "workplace.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await writeFile(path.join(output, "receipt.json"), JSON.stringify({ passed: true, fixture: fixture.info, receipts, before, afterOpen, errors, checks: ["home and inbox do not launch", "recipient remains selectable", "only own details expose workplace", "existing conversation readable and unchanged", "open does not forward", "named launch requires separate approval", "launch sends no input", "stop and force stop require distinct approvals"], limitations: ["Chrome fixture uses HTTP stand-in for local IPC", "Electron window startup fails on this machine", "real Claude Code, Codex and T3 not executed"] }, null, 2));
  console.log(`PASS workplace fixture: ${output}`);
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  if (chrome) await killTree(chrome);
  await workplaces.stopAll(true); await preview?.close(); await fixture.close();
}
