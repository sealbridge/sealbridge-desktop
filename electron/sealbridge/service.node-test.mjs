import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { fixtureRuntime } from "./fixtures/runtime.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { createCoreService, registerCoreIpc } from "./service.mjs";

const did = "did:key:z6MkiTBz1yUom";
async function fixture(t, options = {}) {
  const hosts = [];
  const events = new EventEmitter();
  let running = 0;
  const service = createCoreService({ runtimeDir: await fixtureRuntime(t), dataDir: "/unused-fixture-data", backoffMs: 10, maxRestarts: 2,
    hostFactory(settings) {
      const host = {
        async start() {
          running++;
          events.emit("started");
          settings.onIdentity(did);
          return { initialize: { serverInfo: { version: "0.6.2", secret: "fixture-secret" } } };
        },
        async close() { if (!host.closed) { host.closed = true; running--; } },
        crash: () => settings.onExit(), unavailable: () => settings.onUnavailable(),
      };
      hosts.push(host);
      return host;
    }, ...options });
  return { service, hosts, events, running: () => running };
}

test("service exposes only public status and bounds crash recovery with backoff", { timeout: 10000 }, async t => {
  const { service, hosts, events, running } = await fixture(t);
  t.after(() => service.close());
  await service.start();
  assert.deepEqual(service.status(), { state: "ready", did, version: "0.6.2" });
  hosts[0].crash();
  assert.equal(service.status().state, "restarting");
  assert.equal(hosts.length, 1);
  await once(events, "started");
  await service.start();
  assert.equal(hosts.length, 2);
  hosts[1].crash();
  await once(events, "started");
  await service.start();
  assert.equal(hosts.length, 3);
  hosts[2].crash();
  assert.equal(service.status().state, "failed");
  await delay(40);
  assert.equal(hosts.length, 3);
  await service.retry();
  assert.equal(hosts.length, 4);
  await service.close();
  assert.equal(running(), 0);
});

test("unavailable key store stops automatic retries; quit cancels recovery", async t => {
  const { service, hosts } = await fixture(t);
  await service.start();
  hosts[0].unavailable(); hosts[0].crash();
  assert.equal(service.status().state, "key-store-unavailable");
  await delay(40);
  assert.equal(hosts.length, 1);
  await service.retry();
  assert.equal(service.status().state, "ready");
  hosts[1].crash();
  await service.close();
  await delay(40);
  assert.equal(hosts.length, 2);
  assert.equal(service.status().state, "stopped");
});

test("fixed IPC methods enforce local sender checks and discard renderer arguments", async t => {
  const { service } = await fixture(t);
  t.after(() => service.close());
  await service.start();
  const handlers = new Map();
  registerCoreIpc({ service, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (_channel, handler) => (event, ...args) => {
      if (!event.local) throw new Error("Refused");
      return handler(event, ...args);
    } });
  assert.deepEqual([...handlers.keys()], ["sealbridge:status", "sealbridge:retry"]);
  assert.throws(() => handlers.get("sealbridge:status")({ local: false }));
  const response = handlers.get("sealbridge:status")({ local: true }, { privateKey: "fixture-secret" });
  assert.deepEqual(response, { state: "ready", did, version: "0.6.2" });
  assert.equal(JSON.stringify(response).includes("fixture-secret"), false);
});

test("readiness waits for both channels and ignores identity from an older generation", { timeout: 10000 }, async t => {
  const settings = [];
  const events = new EventEmitter();
  const service = createCoreService({ runtimeDir: await fixtureRuntime(t), identityTimeoutMs: 1000, hostFactory(options) {
    settings.push(options);
    events.emit("created");
    return { async start() { return { initialize: { serverInfo: { version: "0.6.2" } } }; }, async close() {} };
  } });
  t.after(() => service.close());
  const firstCreated = once(events, "created");
  const first = service.start();
  await firstCreated;
  assert.deepEqual(service.status(), { state: "starting", did: null, version: null });
  settings[0].onIdentity(did);
  assert.equal((await first).state, "ready");
  const secondCreated = once(events, "created");
  const second = service.retry();
  await secondCreated;
  settings[0].onIdentity(did);
  assert.deepEqual(service.status(), { state: "starting", did: null, version: null });
  settings[1].onIdentity("did:key:second");
  assert.equal((await second).did, "did:key:second");
});

test("missing identity times out and close cancels the wait", { timeout: 10000 }, async t => {
  const runtimeDir = await fixtureRuntime(t);
  const events = new EventEmitter();
  const make = () => createCoreService({ runtimeDir, identityTimeoutMs: 30, maxRestarts: 0,
    hostFactory: () => ({ async start() { events.emit("started"); return { initialize: { serverInfo: { version: "0.6.2" } } }; }, async close() {} }) });
  const missing = make();
  assert.equal((await missing.start()).state, "failed");
  await missing.close();
  const closing = make();
  const started = once(events, "started");
  const pending = closing.start();
  await started;
  await closing.close();
  await pending;
  assert.equal(closing.status().state, "stopped");
});

test("identity alone cannot mark MCP ready", { timeout: 10000 }, async t => {
  let ready;
  const started = Promise.withResolvers();
  const service = createCoreService({ runtimeDir: await fixtureRuntime(t), hostFactory(options) {
    return { start() {
      options.onIdentity(did);
      return new Promise(resolve => { ready = resolve; started.resolve(); });
    }, async close() {} };
  } });
  t.after(() => service.close());
  const pending = service.start();
  await started.promise;
  assert.equal(service.status().state, "starting");
  ready({ initialize: { serverInfo: { version: "0.6.2" } } });
  assert.equal((await pending).state, "ready");
});
