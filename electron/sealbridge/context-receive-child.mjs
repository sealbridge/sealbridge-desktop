import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { resolveCoreContext } from "./bootstrap.mjs";
import { createContextReceiver, requireReceiveAudit } from "./context-receive-core.mjs";

function normalizedEntryPath(value) {
  let resolved;
  try { resolved = realpathSync(value); }
  catch { resolved = path.resolve(value); }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function runReceiveChild({ input = process.stdin, output = process.stdout,
  packageDir = fileURLToPath(new URL("./node_modules/sealbridge/", import.meta.url)),
  dataDir = process.env.SEALBRIDGE_DATA_DIR, keyringLoader } = {}) {
  const lines = createInterface({ input });
  const send = event => output.write(JSON.stringify(event) + "\n");
  let receiver, timer, started = false, stopped = false;
  const stop = () => { stopped = true; clearInterval(timer); receiver?.stop(); lines.close(); input.destroy(); };
  lines.on("close", () => { stopped = true; clearInterval(timer); receiver?.stop(); });
  lines.on("line", async line => {
    try {
      if (line.length > 524288) throw new Error();
      const message = JSON.parse(line);
      if (message.type === "stop") { stop(); return; }
      if (message.type !== "start") { receiver?.command(message); return; }
      if (started) return;
      started = true;
      requireReceiveAudit(dataDir, message.auditPath);
      const { owner, identityOptions, sdk } = await resolveCoreContext({ packageDir, dataDir, keyringLoader });
      const { signApproval } = sdk;
      if (stopped) return;
      const relays = sdk.readApplicationConfig(identityOptions).relays;
      const trust = new sdk.WorkerTrustStore(owner, { path: sdk.workerIntakePath(owner.did, identityOptions) });
      const selected = trust.listConnections().find(row => row.state === "connected")?.relayUrl ?? relays[0];
      if (!selected) throw new Error("RELAY_UNAVAILABLE");
      receiver = createContextReceiver({ sdk, owner, signApproval, identityOptions, dataDir,
        auditPath: message.auditPath, relay: selected, send });
      timer = setInterval(() => send({ type: "rows", rows: receiver.rows() }), 500);
      send({ type: "ready" });
      await receiver.worker.start();
    } catch { send({ type: "failed" }); stop(); }
  });
}

if (process.argv[1] && normalizedEntryPath(process.argv[1]) === normalizedEntryPath(fileURLToPath(import.meta.url))) await runReceiveChild();
