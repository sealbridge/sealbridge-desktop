import { copy } from "./context-pooling-copy.json";

/** Editable selection declaration, not a ContextGrant or a source-data access capability. */
export interface ContextSelectionDraft {
  selectors: string[];
  fieldsAllowed: string[];
  fieldsDenied: string[];
  angle: string;
  body: string;
  deliveryMode: "view_only" | "approval_redelegation" | "hand_over";
  lifetimeHours: number;
}

/** Display-only projection. Input, selectors, full grant and credentials stay out of IPC responses. */
export interface ContextGrantSummary {
  mode: "view_only" | "approval_redelegation" | "hand_over";
  angle: string;
  allowedCount: number;
  deniedCount: number;
  bytes: number;
  expiresAt: string;
  retention: "none" | "deliverable" | "input";
  digest: string;
}

/** Preparation validates a draft without storing, sending or opening it. */
export type ContextPreparation = { ok: true; summary: ContextGrantSummary } | { ok: false; message: string };

export const defaultContextDraft = (): ContextSelectionDraft => ({
  selectors: [], fieldsAllowed: [], fieldsDenied: [], angle: "", body: "",
  deliveryMode: "view_only", lifetimeHours: 24,
});

export function selectionBytes(body: string): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

export function selectionError(draft: ContextSelectionDraft): string | null {
  if (selectionBytes(draft.body) > 65536) return copy.sizeError;
  if (!Number.isFinite(draft.lifetimeHours) || draft.lifetimeHours > 168) return copy.expiryError;
  if (draft.lifetimeHours <= 0) return copy.expiredSend;
  if (!draft.body.trim() || !draft.angle.trim() || !draft.selectors.length || draft.selectors.some(value => !value.trim()))
    return "切り出し本文・観点・範囲を入力してください。";
  if (draft.fieldsAllowed.some(value => draft.fieldsDenied.includes(value))) return "許可する列と拒否する列が重なっています。";
  if (!["view_only", "approval_redelegation", "hand_over"].includes(draft.deliveryMode)) return copy.preparing;
  return null;
}
