import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { sanitizedEnvironment } from "./mcp-host.mjs";
import { containsSecret, redact } from "./redaction.mjs";
import { createServerSupervisor } from "../server-supervisor.mjs";
import { killTree } from "../shared-computer-access.mjs";

const forbidden = /dangerously|danger[-_ ]full[-_ ]access|full\s*access|bypasspermissions|bypass[-_ ]?(?:approval|sandbox)|--yolo\b|--full-auto\b|--(?:api[-_]?key|auth[-_]?token|access[-_]?token|password|secret)\b|(?:api[_-]?key|auth[_-]?token|access[_-]?token)\s*=/i;
const list = value => Array.isArray(value) && value.length <= 64 && value.every(s => typeof s === "string" && s.length <= 4096 && !/[\0\r\n]/.test(s) && !forbidden.test(s) && !containsSecret(s));
export function parseWorkplace(value) {
  if (!value || typeof value !== "object" || !/^[\w-]{1,80}$/.test(value.id) || ["__proto__", "constructor", "prototype"].includes(value.id) ||
      !["name", "executable", "cwd", "scopeDescription"].every(k => typeof value[k] === "string" && value[k].length <= 4096 && !/[\0\r\n]/.test(value[k]) && !containsSecret(value[k])) ||
      !value.name.trim() || !value.executable.trim() || !path.isAbsolute(value.cwd) || forbidden.test(value.executable) ||
      !["args", "versionArgs", "scopeArgs", "noRecordArgs"].every(k => list(value[k])) ||
      !["none", "text-eof"].includes(value.stdin) || !["interrupt-terminate", "terminate"].includes(value.stop) ||
      !["retained", "unknown"].includes(value.retention)) throw new Error("作業場の設定を確認してください。承認を外す指定や秘密は保存できません。");
  return Object.fromEntries(["id", "name", "executable", "args", "cwd", "versionArgs", "scopeArgs", "scopeDescription", "noRecordArgs", "stdin", "stop", "retention"].map(k => [k, structuredClone(value[k])]));
}
export function parseWorkplaceSettings(raw) {
  const result = { definitions: [], agents: {}, verified: {} };
  for (const value of (Array.isArray(raw?.definitions) ? raw.definitions.slice(0, 32) : [])) {
    try { const d = parseWorkplace(value); if (!result.definitions.some(row => row.id === d.id)) result.definitions.push(d); } catch {}
  }
  for (const [agent, ids] of Object.entries(raw?.agents ?? {})) {
    if (/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(agent) && Array.isArray(ids)) result.agents[agent] = ids.filter(id => result.definitions.some(d => d.id === id));
  }
  for (const d of result.definitions) {
    const v = raw?.verified?.[d.id];
    if (v && typeof v.version === "string" && !containsSecret(v.version)) result.verified[d.id] = { version: v.version.slice(0, 2048), ...Object.fromEntries(["scope", "noRecord", "stdin", "stop"].map(k => [k, v[k] === true])) };
  }
  return result;
}

const environment = () => {
  const env = { ...sanitizedEnvironment(process.env, homedir()), PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "" };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
const waitClose = (child, ms) => (child.exitCode !== null || child.signalCode !== null) && (!child.stdout || child.stdout.readableEnded) && (!child.stderr || child.stderr.readableEnded) ? Promise.resolve(true) : new Promise(resolve => {
  const done = () => { clearTimeout(timer); child.removeListener("close", done); resolve(true); };
  const timer = setTimeout(() => { child.removeListener("close", done); resolve(false); }, ms);
  child.once("close", done);
});

/** No shell, secret-bearing inherited variables, prompt files, or automatic recovery. */
export function createWorkplacePort({ spawnChild = spawn } = {}) {
  return {
    async find(d) {
      const candidates = path.isAbsolute(d.executable) ? [d.executable] : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
        .flatMap(folder => process.platform === "win32" ? [path.join(folder, d.executable), path.join(folder, `${d.executable}.exe`)] : [path.join(folder, d.executable)]);
      for (const file of candidates) {
        if (/\.(?:cmd|bat|ps1|sh)$/i.test(file)) continue;
        try { await access(file, constants.X_OK); return await realpath(file); } catch {}
      }
      return null;
    },
    async version(d, executable) {
      if (!d.versionArgs.length) throw new Error("版を読む引数が未設定です。");
      return new Promise((resolve, reject) => {
        const child = spawnChild(executable, d.versionArgs, { shell: false, windowsHide: true, cwd: d.cwd, env: environment(), stdio: ["ignore", "pipe", "pipe"] });
        let size = 0;
        const chunks = [];
        const timer = setTimeout(() => { void killTree(child); }, 5000);
        child.on("error", () => { clearTimeout(timer); reject(new Error("版を確認できませんでした。")); });
        const collect = chunk => { size += chunk.length; if (size <= 8192) chunks.push(chunk); };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        child.once("close", code => { clearTimeout(timer); if (code === 0 && size <= 8192) resolve(redact(Buffer.concat(chunks).toString("utf8")).trim().slice(0, 2048)); else reject(new Error("版を確認できませんでした。")); });
      });
    },
    launchSpec(d, executable, level, noRecord) {
      const args = [...d.args, ...(level === 1 ? d.scopeArgs : []), ...(noRecord ? d.noRecordArgs : [])];
      if (!list(args)) throw new Error("承認を外す指定は渡せません。");
      return { executable, args, cwd: d.cwd };
    },
    stdin(child, text) { return new Promise((resolve, reject) => child.stdin.end(text, "utf8", error => error ? reject(new Error("入力を渡せませんでした。")) : resolve())); },
    async stop(child, method, force) {
      if (force) await killTree(child);
      else if (process.platform === "win32") await killTree(child, false);
      else { try { process.kill(-child.pid, method === "interrupt-terminate" ? "SIGINT" : "SIGTERM"); } catch { child.kill("SIGTERM"); } }
      if (await waitClose(child, 1500)) return true;
      if (!force && method === "interrupt-terminate") {
        if (process.platform === "win32") await killTree(child, false);
        else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
        return waitClose(child, 1500);
      }
      return false;
    },
    retention(d, noRecord) { return noRecord ? "セッション記録を残さない指定あり。他の履歴・ファイル・提供者側の記録は未確認" : d.retention === "retained" ? "記録が残ります" : "未確認"; },
  };
}

export function createWorkplaces({ prefs, port = createWorkplacePort(), spawnChild = spawn, now = Date.now }) {
  const running = new Map(), discovered = new Map(), pending = new Map();
  const settings = () => parseWorkplaceSettings(prefs.workplaces());
  const definition = id => { const d = settings().definitions.find(d => d.id === id); if (!d) throw new Error("作業場が見つかりません。"); return d; };
  const selected = (agent, id) => { if (!settings().agents[agent]?.includes(id)) throw new Error("この自分のエージェントで作業場を選んでください。"); };
  const state = () => [...running.values()].map(r => ({ ...r.status }));
  const saveSettings = s => { prefs.setWorkplaces(s); return settings(); };
  const api = {
    validateOwnerText: text => typeof text === "string" && !!text.trim() && Buffer.byteLength(text) <= 65536 && !containsSecret(text),
    settings,
    save(value) {
      const d = parseWorkplace(value), s = settings();
      if (running.get(d.id)?.status.running) throw new Error("止めてから設定を変更してください。");
      if (!s.definitions.some(row => row.id === d.id) && s.definitions.length >= 32) throw new Error("作業場は32件までです。");
      s.definitions = [...s.definitions.filter(row => row.id !== d.id), d];
      delete s.verified[d.id]; discovered.delete(d.id); pending.clear();
      return saveSettings(s);
    },
    select(agent, ids) {
      if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(agent) || !Array.isArray(ids)) throw new Error("自分のエージェントを確認できません。");
      const s = settings(); s.agents[agent] = ids.filter(id => s.definitions.some(d => d.id === id)); pending.clear(); return saveSettings(s);
    },
    async find(id) { const d = definition(id), found = await port.find(d); if (JSON.stringify(d) !== JSON.stringify(definition(id))) return null; discovered.set(id, found); return found; },
    async test(id) {
      const d = definition(id), snapshot = JSON.stringify(d), executable = await api.find(id);
      if (!executable) throw new Error("実行ファイルを見つけられませんでした。実体の実行ファイルを指定してください。");
      const version = await port.version(d, executable);
      if (JSON.stringify(definition(id)) !== snapshot) throw new Error("設定が変わりました。再確認してください。");
      const s = settings(); s.verified[id] = { version: version || "版の出力なし", scope: false, noRecord: false, stdin: false, stop: false }; return saveSettings(s);
    },
    verify(id, checks) {
      definition(id); const s = settings();
      if (!s.verified[id]) throw new Error("先に所有者が確認して版を試してください。");
      for (const k of ["scope", "noRecord", "stdin", "stop"]) s.verified[id][k] = checks?.[k] === true;
      pending.clear(); return saveSettings(s);
    },
    status: state,
    async prepare(input) {
      const { id, agent, action } = input; selected(agent, id); const d = definition(id), s = settings();
      if (!["launch", "pass", "stop", "force"].includes(action)) throw new Error("操作を確認できません。");
      const row = running.get(id), level = action === "launch" ? input.level === 1 ? 1 : 0 : row?.status.level ?? 0;
      if (action === "launch" && row?.status.running) throw new Error("すでに起きています。");
      if (action !== "launch" && !row?.status.running) throw new Error("先に作業場を起こしてください。");
      if (level === 1 && (!d.scopeArgs.length || !d.noRecordArgs.length || !s.verified[id]?.scope || !s.verified[id]?.noRecord || !s.verified[id]?.stdin || d.stdin !== "text-eof")) throw new Error("範囲の置き換え・記録の指定・標準入力を確かめるまで段0を使ってください。");
      if (action === "pass" && (level !== 1 || row.status.delivered || !["owner-draft", "owner-file"].includes(input.source) || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.text) > 65536 || containsSecret(input.text))) throw new Error("段1では自分の下書きか、自分で選んだ自分のファイルの場所だけを渡せます。秘密は渡せません。");
      if (action === "force" && !row.forceAllowed) throw new Error("通常の停止が終わらなかった場合だけ強制停止を確認できます。");
      const executable = discovered.get(id);
      if (!executable) throw new Error("作業場の欄で実行ファイルを探してください。");
      const noRecord = action === "launch" ? input.noRecord === true : row.noRecord;
      if (noRecord && (!d.noRecordArgs.length || !s.verified[id]?.noRecord)) throw new Error("記録の指定を確認してください。");
      const spec = action === "launch" ? port.launchSpec(d, executable, level, noRecord) : row.spec;
      const card = { id: randomUUID(), action, name: d.name, executable: spec.executable, version: s.verified[id]?.version ?? "未確認", cwd: spec.cwd,
        scope: `${level === 1 ? d.scopeDescription || "未確認" : `段0: 本文は渡しません。設定・hooks・MCP・既定の権限が動く可能性があります。${d.scopeDescription}`} 引数: ${JSON.stringify(spec.args)}`,
        retention: port.retention(d, noRecord), level, ...(action === "pass" ? { text: input.text, source: input.source } : {}) };
      pending.clear(); pending.set(card.id, { card, d, spec, noRecord, row, expires: now() + 120000, snapshot: JSON.stringify(s) });
      return card;
    },
    async decide(id, accept) {
      const decision = pending.get(id); pending.delete(id);
      if (!decision || accept !== true) return;
      const { card, d, spec, noRecord, row, snapshot, expires } = decision;
      if (now() > expires || snapshot !== JSON.stringify(settings())) throw new Error("確認が期限切れか、設定が変わりました。もう一度確認してください。");
      if (card.action !== "launch" && (running.get(d.id) !== row || !row.status.running)) throw new Error("対象の処理は終了しています。");
      if (card.action === "launch") {
        if (running.get(d.id)?.status.running) throw new Error("すでに起きています。");
        const child = spawnChild(spec.executable, spec.args, { shell: false, windowsHide: true, detached: process.platform !== "win32", cwd: spec.cwd, env: environment(), stdio: ["pipe", "pipe", "pipe"] });
        const entry = { child, spec, noRecord, forceAllowed: false, status: { id: d.id, name: d.name, running: true, level: card.level, delivered: false, output: "", notice: "依頼の本文はまだ渡していません。" } };
        running.set(d.id, entry);
        const supervisor = createServerSupervisor({ restart: () => null, stop: () => port.stop(child, d.stop, true), retryDelaysMs: [], onReady: () => {}, onUnavailable: () => { entry.status.notice = "処理の終了を確認しています。自動では起こし直しません。"; }, onExhausted: () => {} });
        supervisor.pause(); supervisor.watch(child);
        const chunks = []; let bytes = 0;
        const output = chunk => {
          if (bytes >= 65536) return;
          const piece = Buffer.from(chunk).subarray(0, 65536 - bytes); bytes += piece.length; chunks.push(piece);
          const complete = Buffer.concat(chunks).toString("utf8");
          entry.status.output = redact(complete.slice(0, complete.lastIndexOf("\n") + 1));
        };
        child.stdout.on("data", output); child.stderr.on("data", output);
        child.on("error", () => { entry.status.running = false; entry.status.notice = "起こせませんでした。自動では起こし直しません。"; });
        child.stdin.on("error", () => { entry.status.notice = "標準入力が閉じられました。途中の結果は残っていないかもしれません。"; });
        child.once("close", () => { entry.status.output = redact(Buffer.concat(chunks).toString("utf8")); entry.status.running = false; entry.status.notice = "処理が終わりました。履歴やファイルの削除は確認していません。"; });
      } else if (card.action === "pass") {
        if (row.status.delivered) throw new Error("この処理にはすでに渡しました。");
        row.status.delivered = true;
        await port.stdin(row.child, card.text);
        row.status.notice = "自分の材料を標準入力で渡しました。相手への自動送信はしません。";
      } else {
        const stopped = await port.stop(row.child, d.stop, card.action === "force");
        row.forceAllowed = !stopped;
        row.status.notice = stopped ? "処理を止めました。途中の結果は残っていないかもしれません。履歴やファイルは消えません。" : "一定時間で終わりませんでした。強制停止を改めて確認してください。";
        if (stopped) row.status.running = false;
      }
    },
    async stopAll(force = false) {
      for (const [id, row] of running) if (row.status.running) {
        const stopped = await port.stop(row.child, definition(id).stop, force);
        row.status.running = !stopped;
      }
      return !state().some(row => row.running);
    },
  };
  return api;
}

export function registerWorkplaceIpc({ ipcMain, localOnly, workplaces }) {
  for (const method of ["settings", "save", "select", "find", "test", "verify", "status", "prepare", "decide", "validateOwnerText"]) {
    ipcMain.handle(`sealbridge:workplace-${method}`, localOnly(`sealbridge:workplace-${method}`, (_event, ...args) => workplaces[method](...args)));
  }
}
