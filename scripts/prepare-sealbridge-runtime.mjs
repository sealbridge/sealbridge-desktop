import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { developmentRuntimeDir, resolveRuntime } from "../electron/sealbridge/runtime.mjs";

const provenance = JSON.parse(await readFile(new URL("../vendor/sealbridge/provenance.json", import.meta.url), "utf8"));
for (const [file, expected] of [["source.tar.gz", provenance.sourceSha256], ["sealbridge-0.6.3.tgz", provenance.packageSha256]]) {
  const bytes = await readFile(new URL(`../vendor/sealbridge/${file}`, import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Core archive integrity mismatch");
}
const runtimeDir = developmentRuntimeDir;
await mkdir(runtimeDir, { recursive: true });
const installDir = path.resolve("runtime/sealbridge");
const require = createRequire(import.meta.url);
const candidates = [
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  path.join(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).map(directory => path.join(directory, "npm")),
];
let entry;
for (const candidate of candidates) {
  if (!candidate) continue;
  try {
    const resolved = realpathSync(candidate);
    if (!resolved.endsWith("npm-cli.js")) continue;
    entry = require.resolve(resolved);
    break;
  } catch { /* npm layouts vary by Node distribution. */ }
}
if (!entry) throw new Error("Cannot resolve npm CLI JavaScript entry for this Node installation");
const architectures = process.argv.includes("--all-architectures")
  ? [...new Set(["x64", "arm64", process.arch])] : [process.arch];
for (const arch of architectures) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "ci", "--cpu", arch, "--os", process.platform, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--prefix", installDir], {
      shell: false, windowsHide: true, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Pinned CLI installation failed")));
  });
  const target = path.resolve(`build/sealbridge-runtime-${arch}`);
  await rm(target, { recursive: true, force: true });
  await cp(installDir, target, { recursive: true });
  for (const name of ["sdk.mjs", "context-receive-core.mjs", "context-receive-child.mjs", "context-grant-summary.mjs", "context-send-core.mjs", "context-send-child.mjs", "context-send-approval.mjs", "bootstrap.mjs", "core-child.mjs", "invite-child.mjs", "core-invites.mjs", "invite-public.mjs", "redaction.mjs", "invite-secrets.mjs", "invite-errors.mjs"]) {
    await cp(new URL(`../electron/sealbridge/${name}`, import.meta.url), path.join(target, name));
  }
  await cp(new URL("../vendor/sealbridge/provenance.json", import.meta.url), path.join(target, "provenance.json"));
  if (arch === process.arch) {
    await rm(runtimeDir, { recursive: true, force: true });
    await cp(target, runtimeDir, { recursive: true });
  }
}
console.log(resolveRuntime({ runtimeDir }).cliEntry);
