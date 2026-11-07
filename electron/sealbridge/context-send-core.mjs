import { publicString } from "./redaction.mjs";
import { createSendApproval } from "./context-send-approval.mjs";

export async function executeContextSend({ sdk, owner, signApproval, ask, draft, target, auditPath,
  identityOptions, signal, send, clientOptions = {} }) {
  const bytes = Buffer.byteLength(JSON.stringify(draft.body));
  const approvalProvider = createSendApproval({ sdk, owner, signApproval,
    ask: (card, approvalSignal) => ask({ ...card, bytes }, approvalSignal) });
  const client = new sdk.RequesterClient({ ...clientOptions, owner, identityOptions, approvalProvider });
  const { body, lifetimeHours, ...grant } = draft;
  const manifest = sdk.buildTaskManifest({ ownerDid: owner.did, workerDid: target.peerOwnerDid,
    agentDid: target.peerAgentDid, title: "持ち寄り", description: "持ち寄り", protocolVersion: "0.2.0",
    contextGrant: { ...grant, expiresAt: new Date(Date.now() + lifetimeHours * 3600000).toISOString() } });
  try {
    const result = await client.delegate({ to: target.peerOwnerDid, relay: target.relayUrl,
      title: "持ち寄り", description: "持ち寄り", input: body, auditPath, signal,
      manifest,
      beforePropose: async action => {
        const receipt = await approvalProvider.approve({ taskId: action.manifest.taskId, gate: "contract_acceptance",
          target: action.manifest, details: { manifest: action.manifest, bytes }, signal: action.signal });
        if (receipt.payload.decision !== "APPROVED") throw new Error("OWNER_DENIED");
        send({ type: "progress", state: "sending" });
      }, onProgress: () => send({ type: "progress", state: "working" }) });
    const children = result.bundle?.entries?.find(entry => entry?.body?.eventType === "DELIVER")?.body?.payload?.delegation?.children;
    const delegateeOwnerDids = Array.isArray(children)
      ? children.map(child => child?.link?.payload?.delegateeOwnerDid).filter(did => typeof did === "string") : undefined;
    send({ type: "result", state: result.state === "SETTLED" ? "completed" : "cancelled",
      deliverable: result.state === "SETTLED" ? publicString(JSON.stringify(result.deliverable), 65536) : undefined,
      ...(delegateeOwnerDids?.length ? { delegateeOwnerDids } : {}) });
    return result;
  } finally { client.stopDelivery(); }
}

export function contextSendFailureState(error) {
  if (error?.code === "PENDING_OWNER_APPROVAL") return "pending";
  if (/TIMEOUT|TIMED_OUT|TASK_INTERRUPTED/.test(error?.code ?? "") || /TIMEOUT|TIMED_OUT|TASK_INTERRUPTED/.test(error?.message ?? "")) return "timed-out";
  return "failed";
}
