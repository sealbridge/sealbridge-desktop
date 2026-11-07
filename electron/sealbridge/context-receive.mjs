import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { sanitizedEnvironment } from "./mcp-host.mjs";
import { requireReceiveAudit, validNarrowRequest } from "./context-receive-core.mjs";

export function launchContextReceive({ runtimeDir, dataDir, auditPath, home, spawnChild = spawn }) {
  requireReceiveAudit(dataDir, auditPath);
  return spawnChild(process.execPath, [path.join(runtimeDir, "context-receive-child.mjs")], {
    shell: false, windowsHide: true, cwd: home,
    env: { ...sanitizedEnvironment(process.env, home), SEALBRIDGE_DATA_DIR: dataDir }, stdio: ["pipe", "pipe", "pipe"],
  });
}

export function createDesktopReceiver({ runtimeDir, dataDir, launch = launchContextReceive }) {
  let child, starting, stopped = false, state = "idle", rows = [], compose = [], rejected = [], redelegation, approvals = [];
  const write = value => child?.stdin.write(JSON.stringify(value) + "\n");
  return {
    start() {
      starting ??= (async () => {
        if (child || stopped) return;
        let home;
        try {
          await mkdir(path.join(dataDir, "context-audits"), { recursive: true });
          home = await mkdtemp(path.join(tmpdir(), "sealbridge-receive-"));
          if (stopped) { await rm(home, { recursive: true, force: true }); return; }
          const auditPath = path.join(dataDir, "context-audits", randomUUID() + ".jsonl");
          child = launch({ runtimeDir, dataDir, home, auditPath });
          state = "starting";
          const active = child;
          child.stderr.on("data", () => {});
          child.stdin.on("error", () => {});
          child.on("error", () => { state = "failed"; });
          const lines = createInterface({ input: child.stdout });
          lines.on("line", line => {
            try {
              if (line.length > 1048576) throw new Error();
              const event = JSON.parse(line);
              if (event.type === "ready") state = "ready";
              if (event.type === "failed") state = "failed";
              if (event.type === "rows") rows = event.rows;
              if (event.type === "compose") compose.push({ id: event.id, taskId: event.taskId, summary: event.summary });
              if (event.type === "compose-ended") compose = compose.filter(item => item.id !== event.id);
              if (event.type === "rejected") rejected = [...rejected.slice(-99), { taskId: event.taskId, code: event.code }];
              if (event.type === "redelegation") redelegation = { id: event.id, taskId: event.taskId, summary: event.summary,
                parent: event.parent, recipients: Array.isArray(event.recipients) ? event.recipients : [] };
              if (event.type === "redelegation-ended" && redelegation?.id === event.id) redelegation = undefined;
              if (event.type === "approval" && event.card) approvals = [...approvals.filter(item => item.id !== event.id), { id: event.id, ...event.card }];
              if (event.type === "approval-ended") approvals = approvals.filter(item => item.id !== event.id);
            } catch { active.kill(); state = "failed"; }
          });
          child.once("close", () => {
            if (child === active) { child = undefined; state = state === "stopped" ? state : "failed"; rows = []; compose = []; redelegation = undefined; approvals = []; }
            void rm(home, { recursive: true, force: true });
          });
          write({ type: "start", auditPath });
        } catch { state = "failed"; if (home) await rm(home, { recursive: true, force: true }); }
      })().finally(() => { starting = undefined; });
      return starting;
    },
    status: () => ({ state, rows, compose, rejected, redelegation, approvals }),
    action(id, action) {
      if (!["open", "discard"].includes(action) || typeof id !== "string") return { ok: false };
      const row = rows.find(item => item.id === id);
      if (!row || action === "open" && (!row.canOpen || row.inspectionStatus !== "complete" || row.state !== "reviewable")) return { ok: false };
      write({ type: action, id });
      rows = rows.map(item => item.id === id ? { ...item, canOpen: false } : item);
      return { ok: true };
    },
    reply(id, body) {
      if (!compose.some(item => item.id === id) || typeof body !== "string" || !body.trim() || Buffer.byteLength(body) > 65536) return { ok: false };
      write({ type: "reply", id, body }); compose = compose.filter(item => item.id !== id);
      return { ok: true };
    },
    narrow(request) {
      if (!validNarrowRequest(request) || redelegation?.id !== request.id ||
          !redelegation.recipients.some(item => item.id === request.recipientId)) return { ok: false };
      write({ type: "narrow", id: request.id, recipientId: request.recipientId, selectors: request.selectors,
        fieldsAllowed: request.fieldsAllowed, fieldsDenied: request.fieldsDenied, angle: request.angle, body: request.body,
        discloseRoot: request.discloseRoot === true });
      redelegation = undefined;
      return { ok: true };
    },
    decide(id, accept) {
      if (!approvals.some(item => item.id === id) || typeof accept !== "boolean") return { ok: false };
      write({ type: "decide", id, accept });
      approvals = approvals.filter(item => item.id !== id);
      return { ok: true };
    },
    stop() { stopped = true; state = "stopped"; child?.kill(); rows = []; compose = []; rejected = []; redelegation = undefined; approvals = []; },
  };
}

export function registerContextReceiveIpc({ ipcMain, localOnly, receiver }) {
  for (const [name, action] of Object.entries({ status: () => receiver.status(),
    action: (_event, id, action) => receiver.action(id, action), reply: (_event, id, body) => receiver.reply(id, body),
    narrow: (_event, request) => receiver.narrow(request), decide: (_event, id, accept) => receiver.decide(id, accept) })) {
    const channel = `sealbridge:receive-${name}`;
    ipcMain.handle(channel, localOnly(channel, action));
  }
}
