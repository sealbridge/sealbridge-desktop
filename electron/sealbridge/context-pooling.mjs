import path from "node:path";
import { contextGrantSummary } from "./context-grant-summary.mjs";
export { contextGrantSummary, receivedContextSummary } from "./context-grant-summary.mjs";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { developmentRuntimeDir, resolveRuntime } from "./runtime.mjs";

const { copy } = JSON.parse(readFileSync(new URL("../../shared/context-pooling-copy.json", import.meta.url), "utf8"));
const invalid = () => ({ ok: false, message: "切り出しの設定を確認してください。" });
const keys = ["selectors", "fieldsAllowed", "fieldsDenied", "angle", "body", "deliveryMode", "lifetimeHours"];

export function validContextDraft(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key)) &&
    ["selectors", "fieldsAllowed", "fieldsDenied"].every(key => Array.isArray(value[key]) && value[key].length <= 256 &&
      value[key].every(item => typeof item === "string" && item.trim() && item.length <= 1024)) &&
    typeof value.angle === "string" && value.angle.trim() && value.angle.length <= 2048 &&
    typeof value.body === "string" && value.body.trim() && value.body.length <= 65536 &&
    ["view_only", "hand_over", "approval_redelegation"].includes(value.deliveryMode) && typeof value.lifetimeHours === "number";
}

export async function loadContextSdk(runtimeDir = developmentRuntimeDir) {
  resolveRuntime({ runtimeDir });
  return import(pathToFileURL(path.join(runtimeDir, "node_modules/sealbridge/dist/cli/dist/sdk.js")).href);
}

export function createContextPreparation({ loadSdk = loadContextSdk, now = Date.now } = {}) {
  return async draft => {
    try {
      if (typeof draft?.body === "string" && draft.body.length > 65536) return { ok: false, message: copy.sizeError };
      if (!validContextDraft(draft)) return invalid();
      const bytes = Buffer.byteLength(JSON.stringify(draft.body), "utf8");
      if (bytes > 65536) return { ok: false, message: copy.sizeError };
      if (!Number.isFinite(draft.lifetimeHours) || draft.lifetimeHours > 168) return { ok: false, message: copy.expiryError };
      if (draft.lifetimeHours <= 0) return { ok: false, message: copy.expiredSend };
      const sdk = await loadSdk();
      const timestamp = now(), createdAt = new Date(timestamp).toISOString();
      const grant = sdk.buildContextGrant({ selectors: draft.selectors, fieldsAllowed: draft.fieldsAllowed,
        fieldsDenied: draft.fieldsDenied, angle: draft.angle, deliveryMode: draft.deliveryMode,
        expiresAt: new Date(timestamp + draft.lifetimeHours * 3600000).toISOString() }, createdAt);
      sdk.validateContextGrant(grant, createdAt);
      sdk.validateContextGrantUse({ contextGrant: grant, createdAt, protocolVersion: "0.2.0",
        permissions: { maxDelegationDepth: grant.deliveryMode === "approval_redelegation" ? 1 : 0 },
        sandboxPolicy: { filesystemScope: "ephemeral_workspace_only" } }, draft.body, timestamp);
      return { ok: true, summary: contextGrantSummary(sdk, grant, bytes) };
    } catch { return invalid(); }
  };
}

export function registerContextPoolingIpc({ ipcMain, localOnly, prepare = createContextPreparation() }) {
  ipcMain.handle("sealbridge:context-prepare", localOnly("sealbridge:context-prepare", (_event, draft) => prepare(draft)));
}
