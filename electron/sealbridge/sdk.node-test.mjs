import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCoreSdk } from "./sdk.mjs";

const root = new URL("../../", import.meta.url);

test("Desktop resolves the SDK import export from the selected runtime", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "sealbridge-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const packageDir = path.join(dir, "node_modules/sealbridge-local");
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    name: "sealbridge-local", type: "module", exports: { "./sdk": { import: "./public.mjs" } },
  }));
  await writeFile(path.join(packageDir, "public.mjs"), 'export const selected = "fixture";');
  await writeFile(path.join(dir, "sdk-entry.mjs"), await readFile(new URL("runtime/sealbridge/sdk-entry.mjs", root)));
  assert.equal((await loadCoreSdk(packageDir)).selected, "fixture");
});

test("Desktop sources never add bundled internal build paths", async () => {
  const fixturesAwaitingExports = new Set([
    "electron/sealbridge/context-receive.node-test.mjs",
    "electron/sealbridge/context-redelegation.node-test.mjs",
    "electron/sealbridge/context-send.node-test.mjs",
    "electron/sealbridge/key-store-concurrent.node-test.mjs",
  ]);
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" }).split("\0").filter(file =>
      /\.[cm]?[jt]sx?$/.test(file) && !fixturesAwaitingExports.has(file) && file !== "electron/sealbridge/sdk.node-test.mjs" && !file.startsWith("vendor/"));
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /dist\/packages\/|packages\/(?:runtime|core|relay)\/dist|cli\/dist\//, file);
  }
});
