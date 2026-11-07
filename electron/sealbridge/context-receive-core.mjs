import path from "node:path";
import { randomUUID } from "node:crypto";
import { receivedContextSummary } from "./context-grant-summary.mjs";
import { publicString } from "./redaction.mjs";
import { redelegationCard, shortDid } from "./context-send-approval.mjs";

export function requireReceiveAudit(dataDir, auditPath) {
  if (!path.isAbsolute(dataDir ?? "") || !path.isAbsolute(auditPath ?? "") ||
      !path.resolve(auditPath).startsWith(path.resolve(dataDir, "context-audits") + path.sep)) throw new Error("AUDIT_PATH_REQUIRED");
}

function strings(value) {
  return Array.isArray(value) && value.length <= 256 && value.every(item => typeof item === "string" && item.trim() && item.length <= 1024);
}

export function validNarrowRequest(message) {
  return !!message && typeof message.id === "number" && typeof message.recipientId === "string" && message.recipientId.length <= 80 &&
    strings(message.selectors) && message.selectors.length > 0 && strings(message.fieldsAllowed) && strings(message.fieldsDenied) &&
    typeof message.angle === "string" && message.angle.trim() && message.angle.length <= 2048 &&
    typeof message.body === "string" && message.body.trim() && Buffer.byteLength(message.body) <= 65536 &&
    (message.discloseRoot === undefined || typeof message.discloseRoot === "boolean");
}

export function buildNarrowedManifest({ sdk, ownerDid, peer, parent, selectors, fieldsAllowed, fieldsDenied, angle, body, discloseRoot, now = Date.now }) {
  const created = now();
  const timeout = Date.parse(parent.deadline) - created - 1000;
  if (!Number.isFinite(timeout) || timeout < 1000) throw new Error("DELEGATION_INVALID");
  const grant = { selectors, angle, deliveryMode: "view_only", expiresAt: parent.contextGrant.expiresAt,
    retention: "ephemeral_view", inputRetentionAllowed: false };
  if (fieldsAllowed.length) grant.fieldsAllowed = fieldsAllowed;
  if (fieldsDenied.length) grant.fieldsDenied = fieldsDenied;
  const manifest = sdk.buildTaskManifest({ ownerDid, workerDid: peer.peerOwnerDid, agentDid: peer.peerAgentDid ?? peer.peerOwnerDid,
    title: "持ち寄り", description: discloseRoot === true ? `元の依頼主 ${parent.requester.ownerDid}` : "持ち寄り",
    protocolVersion: "0.2.0", now: () => created, taskTimeoutMs: timeout, contextGrant: grant });
  sdk.assertDelegationAttenuation(parent, manifest);
  if (discloseRoot !== true && JSON.stringify({ manifest, body }).includes(parent.requester.ownerDid)) throw new Error("DELEGATION_INVALID");
  if (manifest.permissions.maxDelegationDepth !== 0) throw new Error("DELEGATION_INVALID");
  return manifest;
}

export function createContextReceiver({ sdk, owner, signApproval, identityOptions, auditPath, dataDir,
  relay, send, workerOptions = {}, reviewOptions = {}, enableRedelegation = true }) {
  requireReceiveAudit(dataDir, auditPath);
  const reports = new Map(), decisions = new Map(), replies = new Map(), plans = new Map(), cards = new Map();
  const parentInputs = new Map(), recipientMaps = new Map();
  let sequence = 0, cardSequence = 0, childRequester;
  const provider = sdk.createRuleBasedContentReviewProvider({ onReport: (_recordId, report) => {
    reports.set(report.contentDigest, { verdict: report.verdict, diagnostics: report.diagnostics.map(({ code }) => code),
      findings: [...new Map(report.findings.map(({ ruleId, severity, noteCode }) =>
        [ruleId, { ruleId, severity, noteCode }])).values()] });
  } });
  const heldReview = new sdk.HeldRequestReview(owner, { ...identityOptions, ...reviewOptions, provider: reviewOptions.provider ?? provider });
  const pending = (map, key, signal, publish) => new Promise(resolve => {
    const finish = value => { signal?.removeEventListener("abort", abort); map.delete(key); resolve(value); };
    const abort = () => finish(false);
    map.set(key, finish);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else publish();
  });
  const sign = (request, decision) => signApproval(request.taskId, request.gate, request.target, owner,
    decision === true && !request.signal?.aborted ? "APPROVED" : "REJECTED");
  function connectedPeers(rootDid) {
    const trust = new sdk.WorkerTrustStore(owner, { path: sdk.workerIntakePath(owner.did, identityOptions) });
    return trust.listConnections().filter(row => row.state === "connected" && typeof row.peerOwnerDid === "string" &&
      typeof row.relayUrl === "string" && row.peerOwnerDid !== owner.did && row.peerOwnerDid !== rootDid);
  }
  function rows() {
    const held = heldReview.list().filter(row => row.kind === "task");
    const digests = new Set(held.map(row => row.contentDigest));
    for (const key of reports.keys()) if (!digests.has(key)) reports.delete(key);
    return held.map(row => {
      const result = { id: row.id, taskId: row.taskId, sender: shortDid(row.senderOwnerDid), state: row.state,
        inspectionStatus: row.inspectionStatus, expiresAt: row.expiresAt,
        inspection: reports.get(row.contentDigest), canOpen: decisions.has(row.taskId) };
      if (row.state === "expired" || row.inspectionStatus === "pending") return result;
      try {
        const record = heldReview.store.read(row.id);
        const content = sdk.taskContent(record.envelope, owner, row.contentDigest, row.envelopeDigest);
        result.preview = (typeof content.input === "string" ? content.input : JSON.stringify(content.input)).slice(0, 4000);
        if (content.manifest.contextGrant && Date.parse(content.manifest.contextGrant.expiresAt) <= Date.now()) {
          result.state = "expired"; result.canOpen = false;
        } else if (row.inspectionStatus === "complete") {
          result.summary = receivedContextSummary(sdk, content.manifest, content.input);
        }
      } catch { result.canOpen = false; }
      return result;
    });
  }
  const ownerApprovalProvider = {
    kind: "human", ownerDecision: true,
    async approve(request) {
      if (request.gate === "redelegation") {
        const childGrant = request.details?.childManifest?.contextGrant;
        if (!childGrant || request.details.depthRemaining !== 0) return sign(request, false);
        const digest = sdk.contextGrantAuditPayload(childGrant).grantDigest;
        const card = redelegationCard(sdk, request, parentInputs.get(request.taskId));
        const id = ++cardSequence;
        let approved = false;
        try { approved = await pending(cards, id, request.signal, () => send({ type: "approval", id, card })); }
        finally { send({ type: "approval-ended", id }); }
        let current;
        try { current = sdk.contextGrantAuditPayload(request.details.childManifest.contextGrant).grantDigest; } catch { approved = false; }
        return sign(request, approved === true && current === digest);
      }
      if (request.gate === "final_verification") {
        const digest = request.details?.deliverableDigest;
        const data = request.target?.artifact?.payload?.data;
        const card = { gate: "final_verification", deliverable: publicString(typeof data === "string" ? data : JSON.stringify(data), 65536),
          deliverableDigest: digest, delegateeOwnerDids: Array.isArray(request.details?.delegateeOwnerDids)
            ? request.details.delegateeOwnerDids.filter(did => typeof did === "string").map(shortDid) : undefined };
        const id = ++cardSequence;
        let approved = false;
        try { approved = await pending(cards, id, request.signal, () => send({ type: "approval", id, card })); }
        finally { send({ type: "approval-ended", id }); }
        return sign(request, approved === true && digest === request.details?.deliverableDigest);
      }
      const row = heldReview.list().find(item => item.taskId === request.taskId);
      const manifest = request.details?.manifest;
      const permitted = request.gate === "contract_acceptance" && row?.inspectionStatus === "complete" &&
        row.state === "reviewable" && (!manifest?.contextGrant || ["view_only", "hand_over", "approval_redelegation"].includes(manifest.contextGrant.deliveryMode));
      let approved = false;
      if (permitted) {
        const digest = manifest.contextGrant && sdk.contextGrantAuditPayload(manifest.contextGrant).grantDigest;
        approved = await pending(decisions, request.taskId, request.signal, () => send({ type: "rows", rows: rows() }));
        try {
          receivedContextSummary(sdk, manifest, request.details.input);
          approved = approved && digest === (manifest.contextGrant && sdk.contextGrantAuditPayload(manifest.contextGrant).grantDigest);
        } catch { approved = false; }
      }
      return sign(request, approved === true);
    },
  };
  if (enableRedelegation) {
    const protocolPeers = { observe() {}, observePolicy: policy => policy,
      floor: (peer, agent) => connectedPeers().some(row => row.peerOwnerDid === peer &&
        (agent === peer || agent === (row.peerAgentDid ?? peer))) ? "0.2.0" : undefined };
    childRequester = new sdk.RequesterClient({ owner, identityOptions, relay, approvalProvider: ownerApprovalProvider,
      allowPrivateRelay: workerOptions.allowPrivateRelay, protocolPeers });
  }
  const adapter = { id: "desktop-human", name: "手入力", skills: [], async executeTask(context) {
    if (context.redelegate) {
      parentInputs.set(context.taskId, context.input);
      const id = ++sequence;
      const known = new Map();
      recipientMaps.set(id, known);
      let plan;
      try {
        const recipients = connectedPeers(context.manifest.requester.ownerDid).map(row => {
          const recipientId = randomUUID();
          known.set(recipientId, row);
          return { id: recipientId, name: publicString(row.peerDisplayName ?? "つながっている相手", 120), did: shortDid(row.peerOwnerDid) };
        });
        const grant = context.manifest.contextGrant;
        plan = await pending(plans, id, context.signal, () => send({ type: "redelegation", id, taskId: context.taskId,
          summary: receivedContextSummary(sdk, context.manifest, context.input),
          parent: { angle: grant.angle, selectors: grant.selectors, fieldsAllowed: grant.fieldsAllowed ?? [],
            fieldsDenied: grant.fieldsDenied ?? [], body: typeof context.input === "string" ? context.input : JSON.stringify(context.input) },
          recipients }));
      } finally { send({ type: "redelegation-ended", id }); recipientMaps.delete(id); }
      if (!plan) throw new Error("OWNER_DENIED");
      const peer = known.get(plan.recipientId);
      if (!peer) throw new Error("DELEGATION_INVALID");
      let manifest;
      try {
        manifest = buildNarrowedManifest({ sdk, ownerDid: owner.did, peer, parent: context.manifest, selectors: plan.selectors,
          fieldsAllowed: plan.fieldsAllowed, fieldsDenied: plan.fieldsDenied, angle: plan.angle, body: plan.body,
          discloseRoot: plan.discloseRoot === true });
      } catch (error) {
        send({ type: "rejected", taskId: context.taskId, code: "DELEGATION_INVALID" });
        throw error;
      }
      const childAudit = path.join(dataDir, "context-audits", randomUUID() + ".jsonl");
      requireReceiveAudit(dataDir, childAudit);
      try {
        const result = await context.redelegate({ to: peer.peerOwnerDid, relay: peer.relayUrl, manifest, input: plan.body, auditPath: childAudit });
        parentInputs.delete(context.taskId);
        return result.deliverable;
      } catch (error) {
        const code = /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : /^[A-Z0-9_]+/.test(error?.message ?? "") ? error.message.split(":")[0] : "DELEGATION_INVALID";
        send({ type: "rejected", taskId: context.taskId, code });
        throw error;
      }
    }
    const id = ++sequence;
    const summary = receivedContextSummary(sdk, context.manifest, context.input);
    let value;
    try { value = await pending(replies, id, context.signal, () => send({ type: "compose", id, taskId: context.taskId, summary })); }
    finally { send({ type: "compose-ended", id }); }
    if (typeof value !== "string") throw new Error("OWNER_DENIED");
    return value;
  } };
  const worker = new sdk.WorkerNode({ ...workerOptions, owner, relay, identityOptions, auditPath,
    heldReview, ownerApprovalProvider, approvalProvider: ownerApprovalProvider, adapter, adapterKind: "non-llm",
    requireConnection: true, publishToRegistry: false,
    ...(childRequester ? { redelegation: { requester: childRequester, ownerApprovalProvider } } : {}),
    onWorkspaceCleanupError: () => send({ type: "notice", code: "WORKSPACE_CLEANUP_FAILED" }),
    onEvent: (event, taskId, error) => {
      if (event === "REJECTED") send({ type: "rejected", taskId, code: /^[A-Z_0-9]+$/.test(error?.code ?? "") ? error.code : "REQUEST_REJECTED" });
    } });
  return {
    worker, heldReview, rows,
    command(message) {
      if (message.type === "open") {
        const row = rows().find(item => item.id === message.id);
        if (!row?.canOpen || row.inspectionStatus !== "complete" || row.state !== "reviewable") return false;
        decisions.get(row.taskId)?.(true); return true;
      }
      if (message.type === "discard") {
        const row = heldReview.list().find(item => item.id === message.id);
        if (!row) return false;
        decisions.get(row.taskId)?.(false);
        return heldReview.discard(row.id);
      }
      if (message.type === "reply" && typeof message.body === "string" && message.body.trim() &&
          Buffer.byteLength(message.body) <= 65536 && replies.has(message.id)) {
        replies.get(message.id)(message.body); return true;
      }
      if (message.type === "narrow" && validNarrowRequest(message) && plans.has(message.id) && recipientMaps.get(message.id)?.has(message.recipientId)) {
        plans.get(message.id)({ recipientId: message.recipientId, selectors: message.selectors, fieldsAllowed: message.fieldsAllowed,
          fieldsDenied: message.fieldsDenied, angle: message.angle, body: message.body, discloseRoot: message.discloseRoot === true });
        return true;
      }
      if (message.type === "decide" && typeof message.accept === "boolean" && cards.has(message.id)) {
        cards.get(message.id)(message.accept); return true;
      }
      return false;
    },
    stop() {
      for (const finish of [...decisions.values(), ...replies.values(), ...plans.values(), ...cards.values()]) finish(false);
      worker.stop(); worker.stopDelivery(); childRequester?.stopDelivery(); reports.clear(); parentInputs.clear(); recipientMaps.clear();
    },
  };
}
