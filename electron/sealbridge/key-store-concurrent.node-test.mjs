import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { resolveCoreContext } from "./bootstrap.mjs";
import { fixtureKeyring } from "./fixtures/encrypted-keyring.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";
import { sanitizedEnvironment } from "./mcp-host.mjs";

const packageDir = path.join(developmentRuntimeDir, "node_modules/sealbridge-local");

test("two overlapping Desktop key readers share owner and verify each other's signatures", { timeout: 20000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "sealbridge-concurrent-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { owner } = await resolveCoreContext({ packageDir, dataDir: dir,
    keyringLoader: async () => fixtureKeyring(dir) });
  const script = path.join(dir, "reader.mjs");
  await writeFile(script, `
import { resolveCoreContext } from ${JSON.stringify(new URL("./bootstrap.mjs", import.meta.url).href)};
import { fixtureKeyring } from ${JSON.stringify(new URL("./fixtures/encrypted-keyring.mjs", import.meta.url).href)};
import { signPayload, verifySigned } from ${JSON.stringify(new URL("../../build/sealbridge-runtime/node_modules/sealbridge-local/dist/packages/core/dist/index.js", import.meta.url).href)};
const { owner } = await resolveCoreContext({ packageDir: ${JSON.stringify(packageDir)}, dataDir: process.env.SEALBRIDGE_DATA_DIR,
  keyringLoader: async () => fixtureKeyring(process.env.SEALBRIDGE_DATA_DIR) });
process.send({ type: "opened", did: owner.did });
process.on("message", message => {
  if (message.type === "sign") process.send({ type: "signed", value: signPayload({ type: "ConcurrentReadCheck", reader: message.reader }, owner) });
  if (message.type === "verify") {
    process.send({ type: "verified", valid: verifySigned(message.value, owner.did) });
    process.disconnect();
  }
});
`);
  const children = [0, 1].map(() => fork(script, [], {
    env: { ...sanitizedEnvironment(process.env, dir), SEALBRIDGE_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe", "ipc"],
  }));
  t.after(() => children.forEach(child => child.kill()));
  let output = "";
  for (const child of children) {
    child.stdout.on("data", bytes => { output += bytes; });
    child.stderr.on("data", bytes => { output += bytes; });
  }
  const opened = await Promise.all(children.map(child => once(child, "message")));
  for (const [message] of opened) assert.deepEqual(message, { type: "opened", did: owner.did });
  assert.ok(children.every(child => child.connected && child.exitCode === null));
  const signatures = await Promise.all(children.map(async (child, reader) => {
    const response = once(child, "message");
    child.send({ type: "sign", reader });
    const [message] = await response;
    assert.equal(message.type, "signed");
    return message.value;
  }));
  const exits = children.map(child => once(child, "exit"));
  await Promise.all(children.map(async (child, index) => {
    const response = once(child, "message");
    child.send({ type: "verify", value: signatures[1 - index] });
    assert.deepEqual((await response)[0], { type: "verified", valid: true });
  }));
  for (const result of await Promise.all(exits)) assert.equal(result[0], 0);
  assert.equal(output, "");
  t.diagnostic("Both readers remained open across the barrier; owner DID matched; mutual verification passed; stdout/stderr empty.");
});
