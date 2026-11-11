import { inviteErrorCode } from "./invite-errors.mjs";
import { fileURLToPath } from "node:url";
import { createCoreInvites } from "./core-invites.mjs";

try {
  const api = await createCoreInvites({
    packageDir: fileURLToPath(new URL("./node_modules/sealbridge-local/", import.meta.url)),
    dataDir: process.env.SEALBRIDGE_DATA_DIR,
  });
  const [action, ref] = process.argv.slice(2);
  let result;
  if (action === "import") {
    let token = "";
    const timer = setTimeout(() => process.exit(1), 10000);
    for await (const chunk of process.stdin) {
      token += chunk.toString("utf8");
      if (Buffer.byteLength(token) > 68 * 1024) throw new Error();
    }
    clearTimeout(timer);
    result = api.import(token);
    token = "";
  } else if (/^saved:[a-f0-9]{64}$/.test(ref) && action === "remove") result = api.remove(ref);
  else if (/^saved:[a-f0-9]{64}$/.test(ref) && action === "confirm") result = await api.confirm(ref);
  else throw new Error();
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: inviteErrorCode(error) }));
  process.exitCode = 1;
}
