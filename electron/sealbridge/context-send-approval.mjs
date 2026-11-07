import { publicString } from "./redaction.mjs";

export const shortDid = did => `${did.slice(0, 16)}…${did.slice(-8)}`;

function linesOf(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.split("\n");
}

/** Card fields come from the live redelegation request, not from an earlier click. */
export function redelegationCard(sdk, request, parentInput) {
  const parent = request.details?.parentManifest, child = request.details?.childManifest, grant = child?.contextGrant;
  const parentGrant = parent?.contextGrant;
  if (!parentGrant || !grant) throw new Error("INVALID_APPROVAL");
  const { grantDigest } = sdk.contextGrantAuditPayload(grant);
  const childLines = new Set(linesOf(request.details.input));
  const droppedLines = linesOf(parentInput).filter(line => line && !childLines.has(line));
  const disclosed = JSON.stringify({ description: child.task?.description, title: child.task?.title, input: request.details.input })
    .includes(parent.requester?.ownerDid);
  return { gate: "redelegation", angle: publicString(parentGrant.angle, 120), recipient: shortDid(request.details.delegateeOwnerDid),
    droppedSelectors: parentGrant.selectors.filter(item => !grant.selectors.includes(item)),
    droppedFields: (parentGrant.fieldsAllowed ?? []).filter(item => !(grant.fieldsAllowed ?? []).includes(item)),
    droppedLines: droppedLines.map(line => publicString(line, 200)).filter(Boolean),
    depthRemaining: request.details.depthRemaining, discloseRoot: disclosed,
    bytes: Buffer.byteLength(JSON.stringify(request.details.input)), expiresAt: grant.expiresAt, digest: grantDigest };
}

export function createSendApproval({ sdk, owner, signApproval, ask }) {
  return {
    kind: "human", ownerDecision: true,
    async approve(request) {
      const manifest = request.details?.manifest;
      const grant = manifest?.contextGrant;
      if (!grant || !["view_only", "hand_over", "approval_redelegation"].includes(grant.deliveryMode)) throw new Error("INVALID_APPROVAL");
      const { grantDigest } = sdk.contextGrantAuditPayload(grant);
      const delegateeOwnerDids = Array.isArray(request.details?.delegateeOwnerDids)
        ? request.details.delegateeOwnerDids.filter(did => typeof did === "string").map(shortDid) : undefined;
      const card = { gate: request.gate, recipient: shortDid(manifest.worker.ownerDid),
        mode: grant.deliveryMode, angle: publicString(grant.angle, 120),
        allowedCount: (grant.fieldsAllowed?.length ?? 0), deniedCount: (grant.fieldsDenied?.length ?? 0),
        bytes: request.details.bytes, expiresAt: grant.expiresAt, digest: grantDigest,
        ...(delegateeOwnerDids?.length ? { delegateeOwnerDids } : {}),
        deliverableDigest: request.details.deliverableDigest,
        deliverable: request.gate === "final_verification" ? publicString(JSON.stringify(request.target?.artifact?.payload?.data), 65536) : undefined };
      const decision = await ask(card, request.signal);
      let current;
      try { current = sdk.contextGrantAuditPayload(request.details.manifest.contextGrant).grantDigest; } catch {}
      return signApproval(request.taskId, request.gate, request.target, owner,
        decision === true && current === card.digest && !request.signal?.aborted ? "APPROVED" : "REJECTED");
    },
  };
}
