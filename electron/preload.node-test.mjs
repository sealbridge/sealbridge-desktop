import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// Node tests run without Electron: satisfy preload's require("electron") from the require cache; the real preload still runs.
const require = createRequire(import.meta.url);

const listeners = new Map();
const exposed = { name: null, api: null };
const invocations = [];
const fakeIpcRenderer = {
  on: (channel, handler) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(handler);
  },
  removeListener: (channel, handler) => {
    listeners.get(channel)?.delete(handler);
  },
  invoke: async (...args) => { invocations.push(args); },
  send: () => undefined,
};
const fakeElectron = {
  ipcRenderer: fakeIpcRenderer,
  contextBridge: {
    exposeInMainWorld: (name, api) => {
      exposed.name = name;
      exposed.api = api;
    },
  },
  webUtils: { getPathForFile: () => "" },
};

const electronEntry = require.resolve("electron");
require.cache[electronEntry] = {
  id: electronEntry,
  filename: electronEntry,
  loaded: true,
  exports: fakeElectron,
};
require("./preload.cjs");

const emit = (channel, ...args) => {
  for (const handler of listeners.get(channel) ?? []) handler({}, ...args);
};
const subscriberCount = (channel) => listeners.get(channel)?.size ?? 0;

test("exposes the full local-shell bridge on window.ogb", () => {
  assert.equal(exposed.name, "ogb");
  assert.equal(typeof exposed.api, "object");
  assert.equal(typeof exposed.api.onOpenAppSettings, "function");
});

test("desktopNotices keeps shown() for a Cloud page on an older release, and asks main nothing", async () => {
  // 0.1.135's page calls desktopNotices.shown(...) as its Cloud Pro popup opens; without it the page threw and went blank.
  const before = invocations.length;
  assert.equal(await exposed.api.desktopNotices.shown("cloud-pro-update-2026-10"), false);
  assert.deepEqual(invocations.slice(before), []);
});

test("openLogsFolder asks main for its own logs folder and names no path", async () => {
  const before = invocations.length;
  await exposed.api.openLogsFolder("C:\\Windows\\System32");
  assert.deepEqual(invocations.slice(before), [["desktop:open-logs"]]);
});

test("copyText forwards only the text over the explicit clipboard:write-text channel", async () => {
  const before = invocations.length;
  await exposed.api.copyText("hello");
  assert.deepEqual(invocations.slice(before), [["clipboard:write-text", "hello"]]);
  assert.equal("ipcRenderer" in exposed.api, false);
});

test("browser control forwards a separate per-device capability, not the cloud grant", async () => {
  const before = invocations.length;
  await exposed.api.companion.browserControl("phone-1", true);
  await exposed.api.companion.browserControl("phone-1", false);
  assert.deepEqual(invocations.slice(before), [
    ["companion:browser-control", "phone-1", true],
    ["companion:browser-control", "phone-1", false],
  ]);
});

test("the talk bridge asks main over its own channels with only what it understands", async () => {
  const before = invocations.length;
  await exposed.api.talkShortcut.state();
  await exposed.api.talkShortcut.set({ enabled: false, key: "ctrl-shift-space", extra: "x" });
  await exposed.api.callActive(true);
  await exposed.api.callActive("yes");
  assert.deepEqual(invocations.slice(before), [["talk-shortcut:state"], ["talk-shortcut:set", { enabled: false, key: "ctrl-shift-space" }], ["call:active", true], ["call:active", false]]);
});

test("account prepare asks for the secure address over its own channel and sends nothing from the page", async () => {
  const before = invocations.length;
  await exposed.api.companionAccount.prepare({ endpoint: "https://evil.example.test" });
  assert.deepEqual(invocations.slice(before), [["companion-account:prepare"]]);
});

test("onOpenAppSettings subscribes to the exact app:open-settings channel, forwards every emit, and unsubscribes cleanly", () => {
  // main.mjs sends "app:open-settings"; a different name would leave the shortcut inert while menu tests still pass.
  const cbCalls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(() => cbCalls.push(1));
  assert.equal(subscriberCount("app:open-settings"), 1);

  emit("app:open-settings");
  emit("app:open-settings");
  assert.equal(cbCalls.length, 2);

  unsubscribe();
  assert.equal(subscriberCount("app:open-settings"), 1, "the preload retains its cold-start listener");
  emit("app:open-settings");
  assert.equal(cbCalls.length, 2);
});

test("an organisation action arriving before React subscriptions is delivered exactly once after mount", async () => {
  emit("app:open-settings", "organization");
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(["app", section]));
  const unsubscribePanel = exposed.api.onOpenAppSettings(section => calls.push(["panel", section]));
  assert.deepEqual(calls, []);
  await Promise.resolve();
  assert.deepEqual(calls, [["app", "organization"], ["panel", "organization"]]);
  unsubscribe(); unsubscribePanel();
  const late = exposed.api.onOpenAppSettings(section => calls.push(["late", section]));
  await Promise.resolve();
  assert.equal(calls.length, 2, "later subscriptions must not reopen Settings");
  late();
});

test("a transient subscription cannot consume a cold-start action before the actual mount", async () => {
  emit("app:open-settings", "organization");
  const calls = [];
  exposed.api.onOpenAppSettings(section => calls.push(section))();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["organization"]);
  unsubscribe();
});

test("native Settings requests accept only the fixed organisation section, Cloud link and plain Cloud settings", () => {
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  emit("app:open-settings", "organization");
  emit("app:open-settings", "cloud");
  emit("app:open-settings", "cloud-settings");
  emit("app:open-settings", "https://other.example");
  emit("app:open-settings", "cloudAccount");
  emit("app:open-settings", "sealbridge://cloud");
  emit("app:open-settings", { section: "organization", url: "https://other.example" });
  emit("app:open-settings", ["cloud"]);
  assert.deepEqual(calls, ["organization", "cloud", "cloud-settings", undefined, undefined, undefined, undefined, undefined]);
  unsubscribe();
});

test("a Cloud link arriving before React subscriptions is delivered exactly once after mount", async () => {
  emit("app:open-settings", "https://other.example");
  emit("app:open-settings", "cloud");
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["cloud"]);
  unsubscribe();
  const late = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["cloud"], "later subscriptions must not reopen Settings");
  late();
});

test("Sealbridge bridge forwards only fixed status and retry operations", async () => {
  const before = invocations.length;
  assert.deepEqual(Object.keys(exposed.api.sealbridge).sort(), ["answerContext", "cancelContext", "contextRecipients", "contextStatus", "deleteReceivedAudit", "inviteDecision", "invites", "pasteInvite", "prepareContext", "receiveAction", "receiveDecide", "receiveNarrow", "receiveReply", "receiveStatus", "receivedAudits", "resetContext", "retry", "startContext", "status"]);
  await exposed.api.sealbridge.status({ privateKey: "fixture-only" });
  await exposed.api.sealbridge.retry("arbitrary-tool");
  assert.deepEqual(invocations.slice(before), [["sealbridge:status"], ["sealbridge:retry"]]);
});

test("invitation preload accepts only opaque decision IDs and fixed choices", async () => {
  const before = invocations.length;
  await exposed.api.sealbridge.inviteDecision("acp-invite:G4_DUMMY_SECRET", "confirm");
  await exposed.api.sealbridge.inviteDecision("11111111-1111-1111-1111-111111111111", "trusted");
  assert.equal(invocations.length, before);
  await exposed.api.sealbridge.invites("acp-invite:G4_DUMMY_SECRET");
  await exposed.api.sealbridge.pasteInvite("acp-invite:G4_DUMMY_SECRET");
  await exposed.api.sealbridge.inviteDecision("11111111-1111-1111-1111-111111111111", "cancel");
  assert.deepEqual(invocations.slice(before), [["sealbridge:invites"], ["sealbridge:invite-paste"], ["sealbridge:invite-decision", "11111111-1111-1111-1111-111111111111", "cancel"]]);
});


test("context preparation exposes one fixed local channel", async () => {
  const before = invocations.length;
  const draft = { body: "DCP_FIXED_DUMMY_SECRET_BODY", deliveryMode: "view_only" };
  await exposed.api.sealbridge.prepareContext(draft, "arbitrary-method");
  assert.deepEqual(invocations.slice(before), [["sealbridge:context-prepare", draft]]);
});

test("received audits use only fixed local IPC operations", async () => {
  const before = invocations.length;
  await exposed.api.sealbridge.receivedAudits("ignored");
  await exposed.api.sealbridge.deleteReceivedAudit("../secret.jsonl");
  await exposed.api.sealbridge.deleteReceivedAudit(12);
  assert.deepEqual(invocations.slice(before), [["sealbridge:received-audits"]]);
  await exposed.api.sealbridge.deleteReceivedAudit("11111111-1111-1111-1111-111111111111.jsonl");
  assert.deepEqual(invocations.slice(before), [["sealbridge:received-audits"], ["sealbridge:received-audit-delete", "11111111-1111-1111-1111-111111111111.jsonl"]]);
});

test("context sending uses only fixed local IPC operations", async () => {
  const before = invocations.length;
  await exposed.api.sealbridge.contextRecipients("ignored");
  await exposed.api.sealbridge.contextStatus("ignored");
  await exposed.api.sealbridge.answerContext(3, false);
  await exposed.api.sealbridge.cancelContext("ignored");
  await exposed.api.sealbridge.resetContext("ignored");
  assert.deepEqual(invocations.slice(before), [["sealbridge:context-recipients"], ["sealbridge:context-status"],
    ["sealbridge:context-answer", 3, false], ["sealbridge:context-cancel"], ["sealbridge:context-reset"]]);
});
