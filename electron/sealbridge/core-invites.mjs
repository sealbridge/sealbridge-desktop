import { resolveCoreContext } from "./bootstrap.mjs";
import { publicInvite } from "./invite-public.mjs";

export async function createCoreInvites(options) {
  const { owner, identityOptions, sdk } = await resolveCoreContext(options);
  const { InviteStore, WorkerTrustStore, workerIntakePath, connectionsCommand } = sdk;
  const trust = new WorkerTrustStore(owner, { path: workerIntakePath(owner.did, identityOptions) });
  const store = await InviteStore.open(owner, identityOptions);
  return {
    import(token) {
      const known = store.list();
      const connections = trust.listConnections();
      const existing = new Set(known.map(entry => entry.workerRef));
      const entry = store.import(token);
      const warnings = [];
      if (known.some(peer => peer.displayName === entry.displayName && peer.ownerDid !== entry.ownerDid))
        warnings.push("same-name-different-did");
      if (known.some(peer => peer.ownerDid === entry.ownerDid &&
          (peer.agentDid !== entry.agentDid || peer.displayName !== entry.displayName)) ||
          connections.some(peer => peer.peerOwnerDid === entry.ownerDid && peer.peerAgentDid && peer.peerAgentDid !== entry.agentDid))
        warnings.push("identity-changed");
      return publicInvite({ ...entry, warnings, owned: !existing.has(entry.workerRef) });
    },
    remove: ref => ({ removed: store.remove(ref) }),
    async confirm(ref) {
      await connectionsCommand(["confirm-invite", ref], { ...options.connectionOptions, identityOptions,
        review: async () => true, output: () => {} });
      return { state: "pending-connection" };
    },
  };
}
