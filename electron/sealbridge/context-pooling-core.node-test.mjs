import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { developmentRuntimeDir } from "./runtime.mjs";
import { createContextPreparation, loadContextSdk, receivedContextSummary } from "./context-pooling.mjs";

const sdk = await loadContextSdk();
const createdAt = "2026-11-01T00:00:00.000Z", now = Date.parse(createdAt);
const options = { selectors: ["$.items"], fieldsAllowed: ["size"], fieldsDenied: ["customer"], angle: "工程の可否だけ" };

test("bundled SDK defaults and active restrictions", async () => {
  const grant = sdk.buildContextGrant(options, createdAt);
  assert.equal(grant.deliveryMode, "view_only");
  assert.equal(grant.expiresAt, "2026-11-02T00:00:00.000Z");
  assert.equal(grant.maxBytes, 65536);
  assert.equal(grant.inputRetentionAllowed, false);
  for (const deliveryMode of ["view_only", "hand_over"]) {
    const result = await createContextPreparation({ now: () => now })({ ...options, body: "あ".repeat(100), deliveryMode, lifetimeHours: 168 });
    assert.equal(result.ok, true);
    assert.equal(result.summary.mode, deliveryMode);
    assert.equal(result.summary.bytes, 302);
  }
  const approvalGrant = sdk.buildContextGrant({ ...options, deliveryMode: "approval_redelegation" }, createdAt);
  assert.equal(approvalGrant.deliveryMode, "approval_redelegation");
  const approval = await createContextPreparation({ now: () => now })({ ...options, body: "input", deliveryMode: "approval_redelegation", lifetimeHours: 24 });
  assert.equal(approval.ok, true);
  assert.equal(approval.summary.mode, "approval_redelegation");
  assert.throws(() => sdk.validateContextGrantUse({ contextGrant: approvalGrant, createdAt, protocolVersion: "0.2.0",
    permissions: { maxDelegationDepth: 0 }, sandboxPolicy: { filesystemScope: "ephemeral_workspace_only" } }, "input", now), /CONTEXT_GRANT_DEPTH_CONFLICT/);
  assert.throws(() => sdk.buildContextGrant({ ...options, deliveryMode: "hand_over", inputRetentionAllowed: true }, createdAt), /SCHEMA_VIOLATION|CONTEXT_GRANT_INPUT_RETENTION_UNAVAILABLE/);
  assert.throws(() => sdk.buildContextGrant({ ...options, expiresAt: "2026-11-08T00:00:01Z" }, createdAt), /CONTEXT_GRANT_EXPIRY_INVALID/);
  const manifest = { contextGrant: grant, createdAt, protocolVersion: "0.2.0", permissions: { maxDelegationDepth: 0 }, sandboxPolicy: { filesystemScope: "ephemeral_workspace_only" } };
  sdk.validateContextGrantUse(manifest, "a".repeat(65534), now);
  const summary = receivedContextSummary(sdk, manifest, "DCP_FIXED_DUMMY_SECRET_BODY", now);
  assert.equal(summary.bytes, Buffer.byteLength(JSON.stringify("DCP_FIXED_DUMMY_SECRET_BODY")));
  assert.equal(JSON.stringify(summary).includes("DCP_FIXED_DUMMY_SECRET_BODY"), false);
  const approvalSummary = receivedContextSummary(sdk, { ...manifest, permissions: { maxDelegationDepth: 1 }, contextGrant: approvalGrant }, "DCP_FIXED_DUMMY_SECRET_BODY", now);
  assert.equal(approvalSummary.mode, "approval_redelegation");
  assert.equal(JSON.stringify(approvalSummary).includes("DCP_FIXED_DUMMY_SECRET_BODY"), false);
  assert.throws(() => sdk.validateContextGrantUse(manifest, "a".repeat(65535), now), /CONTEXT_GRANT_MAX_BYTES_EXCEEDED/);
  assert.throws(() => sdk.validateContextGrantUse(manifest, "ok", now + 86400000), /CONTEXT_GRANT_EXPIRED/);
  const events = [];
  await sdk.appendContextGrantAuditEvent((...args) => { events.push(args); }, "CONTEXT_GRANT", grant);
  assert.equal(JSON.stringify(events).includes(options.angle), false);
  assert.match(JSON.stringify(events), /grantDigest/);
});

test("bundled SDK exposes C-W1 inspection and C-W2 held task content", () => {
  for (const name of ["inspectRuleContent", "createRuleBasedContentReviewProvider", "taskContent"])
    assert.equal(typeof sdk[name], "function", name);
  const root = path.join(developmentRuntimeDir, "node_modules/sealbridge/dist");
  for (const name of ["key-store", "application-config", "mcp-server", "invite-store", "index"])
    assert.ok(statSync(path.join(root, "packages/runtime/dist", name + ".js")).isFile());
  assert.ok(statSync(path.join(root, "cli/dist/sdk.js")).isFile());
  const types = readFileSync(path.join(root, "cli/dist/sdk.d.ts"), "utf8");
  assert.match(types, /export type \{[^}]*\bHeldTaskContent\b[^}]*\} from '\.\.\/\.\.\/packages\/runtime\/dist\/index\.js'/);
  const runtimeTypes = readFileSync(path.join(root, "packages/runtime/dist/held-task-content.d.ts"), "utf8");
  assert.match(runtimeTypes, /export interface HeldTaskContent\b/);
});
