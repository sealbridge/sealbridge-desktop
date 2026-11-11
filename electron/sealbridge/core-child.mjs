import { fileURLToPath } from "node:url";
import { bootstrapCore } from "./bootstrap.mjs";

try {
  const { did, server } = await bootstrapCore({
    packageDir: fileURLToPath(new URL("./node_modules/sealbridge-local/", import.meta.url)),
    dataDir: process.env.SEALBRIDGE_DATA_DIR,
  });
  process.send({ type: "identity", did });
  await server.serve(process.stdin, process.stdout);
  process.disconnect();
} catch (error) {
  const unavailable = /^(?:KEY_STORE_|IDENTITY_|APP_CONFIG_|DATA_DIR_)/.test(error?.message ?? "");
  process.send?.({ type: unavailable ? "unavailable" : "failure" });
  process.exitCode = 1;
  process.disconnect?.();
}
