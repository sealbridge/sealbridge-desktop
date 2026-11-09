import type { ContextSelectionDraft, ContextPreparation, ContextGrantSummary } from "./context-pooling";

/** Public desktop core state. Secret keys and invitation credentials never cross this bridge. */
export interface SealbridgeStatus {
  state: "starting" | "ready" | "restarting" | "failed" | "key-store-unavailable" | "stopped";
  did: string | null;
  version: string | null;
}

/** Fixed local desktop actions; no arbitrary core methods or tool arguments are accepted. */
export interface SealbridgeBridge {
  workplace?: WorkplaceBridge;
  receiveStatus(): Promise<ContextReceiveStatus>;
  receiveAction(id: string, action: "open" | "discard"): Promise<{ ok: boolean }>;
  receiveReply(id: number, body: string): Promise<{ ok: boolean }>;
  receiveNarrow(request: ContextNarrowRequest): Promise<{ ok: boolean }>;
  receiveDecide(id: number, accept: boolean): Promise<{ ok: boolean }>;
  contextRecipients(): Promise<ContextRecipient[]>;
  startContext(id: string, draft: ContextSelectionDraft): Promise<{ ok: boolean }>;
  contextStatus(): Promise<ContextSendStatus>;
  answerContext(id: number, accept: boolean): Promise<{ ok: boolean }>;
  cancelContext(): Promise<{ ok: boolean }>;
  resetContext(): Promise<void>;
  prepareContext(draft: ContextSelectionDraft): Promise<ContextPreparation>;
  receivedAudits(): Promise<ReceivedAuditRecord[]>;
  deleteReceivedAudit(id: string): Promise<{ ok: boolean }>;
  invites(): Promise<SealbridgeInvite[]>;
  inviteDecision(id: string, decision: "confirm" | "cancel"): Promise<{ ok: boolean; state?: string }>;
  pasteInvite(): Promise<{ ok: boolean }>;
  status(): Promise<SealbridgeStatus>;
  retry(): Promise<SealbridgeStatus>;
}

/** Local app preferences. Arguments are individual argv entries, never shell source. */
export interface WorkplaceDefinition {
  id: string;
  name: string;
  executable: string;
  args: string[];
  cwd: string;
  versionArgs: string[];
  scopeArgs: string[];
  scopeDescription: string;
  noRecordArgs: string[];
  stdin: "none" | "text-eof";
  stop: "interrupt-terminate" | "terminate";
  retention: "retained" | "unknown";
}
/** Shared definitions and explicit choices per public identity; no conversation or credentials. */
export interface WorkplaceSettings {
  definitions: WorkplaceDefinition[];
  agents: Record<string, string[]>;
  verified: Record<string, { version: string; scope: boolean; noRecord: boolean; stdin: boolean; stop: boolean }>;
}
/** Memory-only status; output has passed the desktop's secret redaction. */
export interface WorkplaceStatus {
  id: string;
  name: string;
  running: boolean;
  level: 0 | 1;
  delivered: boolean;
  output: string;
  notice: string;
}
/** The six replaceable harness operations. Discovery and version execution require separate owner actions. */
export interface WorkplacePort {
  find(definition: WorkplaceDefinition): Promise<string | null>;
  version(definition: WorkplaceDefinition, executable: string): Promise<string>;
  launchSpec(definition: WorkplaceDefinition, executable: string, level: 0 | 1, noRecord: boolean): { executable: string; args: string[]; cwd: string };
  stdin(child: unknown, text: string): Promise<void>;
  stop(child: unknown, method: WorkplaceDefinition["stop"], force: boolean): Promise<boolean>;
  retention(definition: WorkplaceDefinition, noRecord: boolean): string;
}
/** Local-only bridge. One-use decisions pin the full launch specification or exact owner text. */
export interface WorkplaceBridge {
  validateOwnerText(text: string): Promise<boolean>;
  settings(): Promise<WorkplaceSettings>;
  save(definition: WorkplaceDefinition): Promise<WorkplaceSettings>;
  select(agent: string, ids: string[]): Promise<WorkplaceSettings>;
  find(id: string): Promise<string | null>;
  test(id: string): Promise<WorkplaceSettings>;
  verify(id: string, checks: { scope: boolean; noRecord: boolean; stdin: boolean; stop: boolean }): Promise<WorkplaceSettings>;
  status(): Promise<WorkplaceStatus[]>;
  prepare(input: { action: "launch" | "pass" | "stop" | "force"; agent: string; id: string; level?: 0 | 1; noRecord?: boolean; text?: string; source?: "owner-draft" | "owner-file" }): Promise<WorkplaceDecision>;
  decide(id: string, accept: boolean): Promise<void>;
}
/** Full immutable approval projection; text is never summarized or persisted by Desktop. */
export interface WorkplaceDecision {
  id: string;
  action: "launch" | "pass" | "stop" | "force";
  name: string;
  executable: string;
  version: string;
  cwd: string;
  scope: string;
  retention: string;
  level: 0 | 1;
  text?: string;
  source?: "owner-draft" | "owner-file";
}

/** Token-free invitation preview. The id identifies a pending desktop decision. */
export interface SealbridgeInvite {
  id: string;
  state: "pending" | "error";
  code?: string;
  displayName?: string;
  peerDid?: string;
  expiresAt?: string;
  warnings?: ("same-name-different-did" | "identity-changed")[];
}

/** Display-only connected target; id resolves to routing data in main. */
export interface ContextRecipient { id: string; name: string; did: string; state: "connected" }
/** Transient send state and the SDK approval request projection. */
export interface ContextSendStatus {
  state: string;
  peerRejected?: boolean;
  deliverable?: string;
  approval?: { id: number; gate: string; recipient: string; mode: string; angle: string;
    allowedCount: number; deniedCount: number; bytes: number; expiresAt: string; digest: string; deliverable?: string; deliverableDigest?: string;
    delegateeOwnerDids?: string[] };
  delegateeOwnerDids?: string[];
}

/** Verified audit projection. The selection body is never included. */
export interface ReceivedAuditRecord {
  id: string;
  verified: boolean;
  outputRetained: boolean;
  deliveryMode?: "view_only" | "approval_redelegation" | "hand_over";
  deliverable?: string;
}

/** Memory-only projection of SDK quarantine and live human decisions. */
export interface ContextReceiveStatus {
  state: string;
  rows: { id: string; taskId: string; sender: string; state: string; inspectionStatus: string;
    expiresAt: number; preview?: string; summary?: ContextGrantSummary; canOpen: boolean;
    inspection?: { verdict: string; findings: { ruleId: string; severity: string; noteCode: string }[] } }[];
  compose: { id: number; taskId: string; summary?: ContextGrantSummary }[];
  rejected: { taskId: string; code: string }[];
  redelegation?: { id: number; taskId: string; summary?: ContextGrantSummary;
    parent: { angle: string; selectors: string[]; fieldsAllowed: string[]; fieldsDenied: string[]; body?: string };
    recipients: { id: string; name: string; did: string }[] };
  approvals?: { id: number; gate: string; recipient?: string; angle?: string; droppedSelectors?: string[]; droppedFields?: string[];
    droppedLines?: string[]; depthRemaining?: number; discloseRoot?: boolean; bytes?: number; expiresAt?: string; digest?: string;
    deliverable?: string; deliverableDigest?: string; delegateeOwnerDids?: string[] }[];
}

/** Owner-composed child request. Routing stays in the receive process. */
export interface ContextNarrowRequest {
  id: number;
  recipientId: string;
  selectors: string[];
  fieldsAllowed: string[];
  fieldsDenied: string[];
  angle: string;
  body: string;
  discloseRoot: boolean;
}
