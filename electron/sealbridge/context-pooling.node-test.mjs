import assert from "node:assert/strict";
import test from "node:test";
import { createContextPreparation, registerContextPoolingIpc } from "./context-pooling.mjs";

const secret = "DCP_FIXED_DUMMY_SECRET_BODY";
const draft = () => ({ selectors: ["$.items"], fieldsAllowed: ["size"], fieldsDenied: [secret],
  angle: "工程の可否だけ", body: secret, deliveryMode: "view_only", lifetimeHours: 24 });

test("IPC returns only public summary; failures never echo body, schema or SDK exceptions", async () => {
  const captured = [];
  const sdk = {
    buildContextGrant(options, createdAt) { captured.push(options); return { ...options, createdAt, retention: "ephemeral_view" }; },
    validateContextGrant() {}, validateContextGrantUse(manifest, body) { assert.equal(body, secret); captured.push(manifest.permissions.maxDelegationDepth); },
    contextGrantAuditPayload() { return { grantDigest: "a".repeat(64) }; },
  };
  const handlers = new Map();
  registerContextPoolingIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    localOnly: (_key, fn) => (event, ...args) => { assert.equal(event.local, true); return fn(event, ...args); },
    prepare: createContextPreparation({ loadSdk: async () => sdk, now: () => 0 }) });
  assert.deepEqual([...handlers.keys()], ["sealbridge:context-prepare"]);
  const call = value => handlers.get("sealbridge:context-prepare")({ local: true }, value);
  const result = await call(draft());
  assert.equal(result.ok, true);
  assert.equal(result.summary.expiresAt, "1970-01-02T00:00:00.000Z");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("selectors"), false);
  assert.equal(captured[0].deliveryMode, "view_only");
  assert.equal(captured[1], 0);
  const approval = await call({ ...draft(), deliveryMode: "approval_redelegation" });
  assert.equal(approval.ok, true);
  assert.equal(approval.summary.mode, "approval_redelegation");
  assert.equal(captured.at(-1), 1);
  assert.equal(JSON.stringify(approval).includes(secret), false);
  assert.throws(() => handlers.get("sealbridge:context-prepare")({ local: false }, draft()));
  for (const value of [{ ...draft(), inputRetentionAllowed: true }, null])
    assert.equal((await call(value)).ok, false);
  const failing = createContextPreparation({ loadSdk: () => { throw new Error(secret); } });
  assert.equal(JSON.stringify(await failing(draft())).includes(secret), false);
});

test("byte and expiry refusals are fixed CP0 text and happen before loading runtime", async () => {
  const prepare = createContextPreparation({ loadSdk: () => { throw new Error("must not load"); } });
  assert.deepEqual(await prepare({ ...draft(), body: "あ".repeat(21845) }), { ok: false, message: "切り出しが 64 KB を超えています。列や行を減らしてください" });
  assert.deepEqual(await prepare({ ...draft(), lifetimeHours: 169 }), { ok: false, message: "有効期限は7日以内にしてください" });
  assert.match((await prepare({ ...draft(), lifetimeHours: 0 })).message, /^有効期限を過ぎているため/);
});


test("preparation never logs SDK errors or selected content", async t => {
  const messages = [];
  for (const method of ["log", "warn", "error", "debug", "info"])
    t.mock.method(console, method, (...args) => messages.push(args));
  const prepare = createContextPreparation({ loadSdk: async () => ({
    buildContextGrant() { throw new Error(secret); },
  }) });
  const response = await prepare(draft());
  assert.equal(response.ok, false);
  assert.equal(JSON.stringify({ response, messages }).includes(secret), false);
  assert.deepEqual(messages, []);
});
