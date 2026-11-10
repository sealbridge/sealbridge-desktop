import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { resolveCoreContext } from "./bootstrap.mjs";
import { executeContextSend, contextSendFailureState } from "./context-send-core.mjs";

export function createProtocolPeers(observed, connected) {
  return {
    observe: observed.observe.bind(observed),
    observePolicy: observed.observePolicy.bind(observed),
    floor: (peer, agent) => observed.floor(peer, agent) ?? (
      peer === connected.peerOwnerDid &&
      (agent === connected.peerOwnerDid || agent === (connected.peerAgentDid ?? connected.peerOwnerDid))
        ? "0.2.0" : undefined),
  };
}

function normalizedEntryPath(value) {
  let resolved;
  try { resolved = realpathSync(value); }
  catch { resolved = path.resolve(value); }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

if (process.argv[1] && normalizedEntryPath(process.argv[1]) === normalizedEntryPath(fileURLToPath(import.meta.url))) {
  const lines = createInterface({ input: process.stdin });
  const send = value => process.stdout.write(JSON.stringify(value) + "\n");
  const controller = new AbortController();
  let answer, started = false, sequence = 0;
  lines.on("line", async line => {
    let running = false;
    try {
      const message = JSON.parse(line);
      if (message.type === "cancel") { controller.abort(); answer?.(false); return; }
      if (message.type === "answer") { if (message.id === sequence) answer?.(message.accept === true); return; }
      if (started || message.type !== "start") return;
      started = true; running = true;
      const { draft, target, auditPath } = message;
      if (!path.isAbsolute(auditPath ?? "")) throw new Error();
      const packageDir = fileURLToPath(new URL("./node_modules/sealbridge/", import.meta.url));
      const { owner, identityOptions, sdk } = await resolveCoreContext({ packageDir, dataDir: process.env.SEALBRIDGE_DATA_DIR });
      const { signApproval } = sdk;
      const trust = new sdk.WorkerTrustStore(owner, { path: sdk.workerIntakePath(owner.did, identityOptions) });
      const connected = trust.listConnections().find(row => row.state === "connected" &&
        row.peerOwnerDid === target.peerOwnerDid && row.peerAgentDid === target.peerAgentDid && row.relayUrl === target.relayUrl);
      if (!connected || target.peerOwnerDid === owner.did) throw new Error("CONNECTION_REQUIRED");
      // Sealbridge 0.5.0 connection consent uses the 0.2.0 protocol, including for unpublished peers.
      const { ProtocolPeerStore } = sdk;
      const observed = new ProtocolPeerStore(owner, identityOptions);
      const protocolPeers = createProtocolPeers(observed, connected);
      const bytes = Buffer.byteLength(JSON.stringify(draft.body));
      const ask = (card, signal) => new Promise(resolve => {
        const id = ++sequence;
        const finish = value => { signal?.removeEventListener("abort", abort); answer = undefined; resolve(value); };
        const abort = () => finish(false);
        answer = finish;
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) finish(false);
        else send({ type: "approval", id, card: { ...card, bytes } });
      });
      await executeContextSend({ sdk, owner, signApproval, ask, draft, target, auditPath,
        identityOptions, signal: controller.signal, send, clientOptions: { protocolPeers } });
    } catch (error) {
      const state = controller.signal.aborted ? "cancelled" : contextSendFailureState(error);
      send({ type: "result", state, peerRejected: state === "failed" &&
        (error?.message?.startsWith("PEER_REJECTED:") === true || error?.code === "PROPOSAL_REJECTED") });
    } finally { if (running) { lines.close(); process.stdin.destroy(); } }
  });
}
