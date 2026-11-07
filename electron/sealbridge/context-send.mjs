import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { sanitizedEnvironment } from "./mcp-host.mjs";
import { validContextDraft } from "./context-pooling.mjs";
import { publicString } from "./redaction.mjs";
import { shortDid } from "./context-send-approval.mjs";

export function launchContextSend({ runtimeDir, dataDir, auditPath, home, spawnChild = spawn }) {
  if (!path.isAbsolute(dataDir ?? "") || !path.isAbsolute(auditPath ?? "") ||
      !path.resolve(auditPath).startsWith(path.resolve(dataDir, "context-audits") + path.sep)) throw new Error("AUDIT_PATH_REQUIRED");
  return spawnChild(process.execPath, [path.join(runtimeDir, "context-send-child.mjs")], {
    shell: false, windowsHide: true, cwd: home,
    env: { ...sanitizedEnvironment(process.env, home), SEALBRIDGE_DATA_DIR: dataDir }, stdio: ["pipe", "pipe", "pipe"],
  });
}

export function createContextSender({ service, runtimeDir, dataDir, launch = launchContextSend }) {
  let targets = new Map(), active, starting = false;
  async function connected() {
    const { connections } = await service.listConnections();
    return connections.filter(row => row.state === "connected" && row.peerOwnerDid !== service.status().did &&
      typeof row.peerOwnerDid === "string" && typeof row.relayUrl === "string");
  }
  return {
    async recipients() {
      try {
        targets = new Map((await connected()).map(row => [randomUUID(), row]));
        return [...targets].map(([id, row]) => ({ id, name: publicString(row.peerDisplayName ?? "つながっている相手", 120),
          did: shortDid(row.peerOwnerDid), state: "connected" }));
      } catch { return []; }
    },
    async start(id, draft) {
      if (active || starting || !validContextDraft(draft) || !Number.isFinite(draft.lifetimeHours) || draft.lifetimeHours <= 0 ||
          draft.lifetimeHours > 168 || Buffer.byteLength(JSON.stringify(draft.body)) > 65536) return { ok: false };
      let home;
      starting = true;
      try {
        const selected = targets.get(id);
        if (!selected) return { ok: false };
        const target = (await connected()).find(row => row.peerOwnerDid === selected.peerOwnerDid &&
          row.peerAgentDid === selected.peerAgentDid && row.relayUrl === selected.relayUrl);
        if (!target) return { ok: false };
        const auditDir = path.join(dataDir, "context-audits");
        await mkdir(auditDir, { recursive: true });
        home = await mkdtemp(path.join(tmpdir(), "sealbridge-context-"));
        const auditPath = path.join(auditDir, randomUUID() + ".jsonl");
        const child = launch({ runtimeDir, dataDir, home, auditPath });
        const session = { child, state: "starting" };
        active = session;
        const input = createInterface({ input: child.stdout });
        child.stderr.on("data", () => {});
        child.stdin.on("error", () => {});
        child.on("error", () => { session.state = "failed"; });
        input.on("line", line => {
          try {
            if (line.length > 524288) { child.kill(); return; }
            const event = JSON.parse(line);
            if (session.state === "cancelled") return;
            if (event.type === "approval") { session.state = "approval"; session.approval = { id: event.id, ...event.card }; }
            if (event.type === "progress") { session.state = event.state; session.approval = undefined; }
            if (event.type === "result") { session.state = event.state; session.deliverable = publicString(event.deliverable, 65536); session.peerRejected = event.peerRejected === true;
              session.delegateeOwnerDids = Array.isArray(event.delegateeOwnerDids) ? event.delegateeOwnerDids.filter(did => typeof did === "string").map(shortDid) : undefined;
              session.approval = undefined; }
          } catch { child.kill(); }
        });
        const timer = setTimeout(() => { session.state = "failed"; child.kill(); }, 660000);
        child.once("close", () => {
          clearTimeout(timer); session.approval = undefined;
          if (!["completed", "cancelled", "failed", "pending", "timed-out"].includes(session.state)) session.state = "failed";
          void rm(home, { recursive: true, force: true });
        });
        child.stdin.write(JSON.stringify({ type: "start", draft, target: { peerOwnerDid: target.peerOwnerDid,
          peerAgentDid: target.peerAgentDid, relayUrl: target.relayUrl }, auditPath }));
        child.stdin.write("\n");
        return { ok: true };
      } catch { if (home) await rm(home, { recursive: true, force: true }); return { ok: false }; }
      finally { starting = false; }
    },
    status() { return active ? { state: active.state, approval: active.approval, deliverable: active.deliverable, peerRejected: active.peerRejected, delegateeOwnerDids: active.delegateeOwnerDids } : { state: "idle" }; },
    answer(id, accept) {
      if (!active?.approval || active.approval.id !== id || typeof accept !== "boolean") return { ok: false };
      active.child.stdin.write(JSON.stringify({ type: "answer", id, accept }) + "\n");
      active.approval = undefined; active.state = "waiting";
      return { ok: true };
    },
    cancel(force = false) {
      if (active && !["completed", "failed", "cancelled", "pending", "timed-out"].includes(active.state)) {
        const session = active;
        session.child.stdin.write('{"type":"cancel"}\n');
        if (force) session.child.kill();
        else {
          const timer = setTimeout(() => session.child.kill(), 2000);
          timer.unref(); session.child.once("close", () => clearTimeout(timer));
        }
        session.state = "cancelled"; session.approval = undefined;
      }
      return { ok: true };
    },
    reset() { if (active && ["completed", "cancelled", "failed", "pending", "timed-out"].includes(active.state)) active = undefined; },
  };
}

export function registerContextSendIpc({ ipcMain, localOnly, sender }) {
  for (const [name, action] of Object.entries({ recipients: () => sender.recipients(),
    start: (_event, id, draft) => sender.start(id, draft), status: () => sender.status(),
    answer: (_event, id, accept) => sender.answer(id, accept), cancel: () => sender.cancel(), reset: () => sender.reset() })) {
    const channel = `sealbridge:context-${name}`;
    ipcMain.handle(channel, localOnly(channel, action));
  }
}
