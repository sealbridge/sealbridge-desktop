import path from "node:path";
import { loadCoreSdk } from "./sdk.mjs";

export async function resolveCoreContext({ packageDir, dataDir, keyringLoader }) {
  if (!path.isAbsolute(dataDir ?? "")) throw new Error("DATA_DIR_UNAVAILABLE");
  const sdk = await loadCoreSdk(packageDir);
  const { resolveStoredIdentity, selectKeyStore, setApplicationKeyStore } = sdk;
  const identityOptions = { env: { SEALBRIDGE_DATA_DIR: dataDir }, keyStore: "keychain", keyringLoader };
  await (await selectKeyStore("requester", identityOptions)).exists("requester");
  setApplicationKeyStore("keychain", identityOptions);
  const owner = await resolveStoredIdentity("requester", identityOptions);
  return { owner, identityOptions, sdk };
}

export async function bootstrapCore(options) {
  const { owner, identityOptions, sdk } = await resolveCoreContext(options);
  const { AcpMcpServer } = sdk;
  const server = new AcpMcpServer({ identityOptions, owner, requireInteractiveApproval: true });
  return { did: owner.did, server };
}
