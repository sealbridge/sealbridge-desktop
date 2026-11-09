import path from "node:path";
import { product } from "./product.mjs";
import { McpHost } from "./mcp-host.mjs";
import { developmentRuntimeDir, resolveRuntime } from "./runtime.mjs";

export function createCoreService({ dataDir, resourcesPath, runtimeDir = developmentRuntimeDir,
  nodeBinary = process.execPath, hostFactory = options => new McpHost(options), maxRestarts = 5,
  identityTimeoutMs = 15000, backoffMs = 1000 } = {}) {
  let status = { state: "starting", did: null, version: null };
  let host, pending, timer, stopped = false, attempts = 0, unavailable = false;
  let generation, cancelIdentity;
  const snapshot = () => ({ ...status });
  function recover() {
    if (stopped || unavailable || timer) return;
    cancelIdentity?.();
    status = { ...status, state: attempts >= maxRestarts ? "failed" : "restarting" };
    if (attempts >= maxRestarts) return;
    timer = setTimeout(async () => {
      await pending;
      timer = undefined;
      if (!stopped && !unavailable) await start();
    }, Math.min(30000, backoffMs * 2 ** attempts++));
  }
  function start() {
    if (stopped) return Promise.resolve(snapshot());
    pending ??= (async () => {
      const current = {};
      generation = current;
      status = { state: "starting", did: null, version: null };
      let identityTimer;
      try {
        await host?.close();
        if (stopped) return snapshot();
        const runtime = resolveRuntime({ resourcesPath, runtimeDir, nodeBinary });
        const root = resourcesPath ? path.join(resourcesPath, "sealbridge-runtime") : runtimeDir;
        let acceptIdentity;
        const identity = new Promise((resolve, reject) => {
          acceptIdentity = resolve;
          cancelIdentity = () => reject(new Error());
          identityTimer = setTimeout(cancelIdentity, identityTimeoutMs);
        });
        host = hostFactory({ ...runtime, cliEntry: path.join(root, "core-child.mjs"), dataDir,
          timeoutMs: 15000,
          onIdentity(did) { if (generation === current && !stopped) acceptIdentity(did); },
          onUnavailable() { if (generation !== current || stopped) return; unavailable = true; cancelIdentity?.(); status = { ...status, state: "key-store-unavailable" }; },
          onExit() { if (generation === current) recover(); },
        });
        const [{ initialize }, did] = await Promise.all([host.start(), identity]);
        if (!stopped && !unavailable && status.state === "starting") status = { ...status, did, state: "ready", version: initialize.serverInfo.version === product.cliVersion ? product.cliVersion : null };
      } catch {
        await host?.close();
        if (unavailable) status = { ...status, state: "key-store-unavailable" };
        else recover();
      } finally { clearTimeout(identityTimer); cancelIdentity = undefined; }
      return snapshot();
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return Object.freeze({
    start, status: snapshot,
    async listConnections() {
      if (status.state !== "ready") throw new Error();
      const result = await host.callTool("acp_list_connections", {});
      if (result?.isError) throw new Error();
      return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === "text").text);
    },
    async retry() {
      if (stopped) return snapshot();
      clearTimeout(timer); timer = undefined;
      if (pending) await pending;
      unavailable = false; attempts = 0;
      return start();
    },
    async close() {
      stopped = true;
      cancelIdentity?.();
      clearTimeout(timer); timer = undefined;
      await host?.close();
      await pending;
      status = { ...status, state: "stopped" };
    },
  });
}

export function registerCoreIpc({ ipcMain, localOnly, service }) {
  ipcMain.handle("sealbridge:status", localOnly("sealbridge:status", () => service.status()));
  ipcMain.handle("sealbridge:retry", localOnly("sealbridge:retry", () => service.retry()));
}

export function createCoreClose({ service, receiver, sender }) {
  let closed;
  return () => {
    if (!closed) {
      receiver.stop();
      sender.cancel(true);
      closed = Promise.resolve(service.close());
    }
    return closed;
  };
}
