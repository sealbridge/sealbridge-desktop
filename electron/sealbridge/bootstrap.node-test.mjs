import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bootstrapCore } from "./bootstrap.mjs";
import { fixtureKeyring } from "./fixtures/encrypted-keyring.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";
import { sanitizedEnvironment } from "./mcp-host.mjs";

const packageDir = path.join(developmentRuntimeDir, "node_modules/sealbridge-local");
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "sealbridge-core-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : readFile(file);
  }))).flat();
}

test("core bootstrap reuses its OS-store identity; files and public MCP replies contain no key material", async t => {
  const dir = await fixture(t);
  const secrets = [];
  const keyringLoader = async () => fixtureKeyring(dir, value => {
    const key = JSON.parse(value);
    secrets.push(value, key.d);
  });
  const first = await bootstrapCore({ packageDir, dataDir: dir, keyringLoader });
  const second = await bootstrapCore({ packageDir, dataDir: dir, keyringLoader });
  assert.equal(first.did, second.did);
  assert.match(first.did, /^did:key:/);
  const reply = JSON.stringify(await second.server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  for (const bytes of [...await files(dir), Buffer.from(reply)]) {
    assert.equal(bytes.includes(Buffer.from("PRIVATE KEY")), false);
    for (const secret of secrets) assert.equal(bytes.includes(Buffer.from(secret)), false);
  }
  const config = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
  assert.equal(config.keyStore, "keychain");
  assert.equal((await readdir(dir)).some(name => name.includes("private")), false);
});

for (const mode of ["missing", "locked", "write-fails", "corrupt"]) {
  test(`core refuses ${mode} OS storage without file fallback`, async t => {
    const dir = await fixture(t);
    const keyringLoader = async () => {
      if (mode === "missing") throw new Error("unavailable");
      return { Entry: class {
        getPassword() {
          if (mode === "locked") throw new Error();
          return mode === "corrupt" ? "invalid" : null;
        }
        setPassword() { throw new Error(); }
      } };
    };
    await assert.rejects(bootstrapCore({ packageDir, dataDir: dir, keyringLoader }));
    const bytes = Buffer.concat(await files(dir)).toString();
    assert.doesNotMatch(bytes, /PRIVATE KEY|"d"\s*:/);
    assert.equal((await readdir(dir)).some(name => name.includes("private")), false);
  });
}

test("separate child launches retain DID; child IPC and output expose only public data", async t => {
  const dir = await fixture(t);
  const bootstrapUrl = new URL("./bootstrap.mjs", import.meta.url).href;
  const keyringUrl = new URL("./fixtures/encrypted-keyring.mjs", import.meta.url).href;
  const script = path.join(dir, "child.mjs");
  await writeFile(script, `
import { bootstrapCore } from ${JSON.stringify(bootstrapUrl)};
import { fixtureKeyring } from ${JSON.stringify(keyringUrl)};
const { did } = await bootstrapCore({ packageDir: ${JSON.stringify(packageDir)}, dataDir: ${JSON.stringify(dir)},
  keyringLoader: async () => fixtureKeyring(${JSON.stringify(dir)}) });
process.send({ did });
process.disconnect();
`);
  async function launch() {
    const child = fork(script, [], { env: sanitizedEnvironment(process.env, dir), stdio: ["pipe", "pipe", "pipe", "ipc"] });
    let output = "", response;
    child.stdout.on("data", bytes => { output += bytes; });
    child.stderr.on("data", bytes => { output += bytes; });
    child.on("message", message => { response = message; });
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error("Fixture child failed")));
    });
    assert.deepEqual(Object.keys(response), ["did"]);
    assert.ok(output.length === 0);
    assert.match(response.did, /^did:key:/);
    return response.did;
  }
  assert.equal(await launch(), await launch());
});

test("real stdio host and service bootstrap twice with no secret in renderer replies or logs", async t => {
  const { McpHost } = await import("./mcp-host.mjs");
  const { createCoreService, registerCoreIpc } = await import("./service.mjs");
  const dir = await fixture(t);
  const script = path.join(dir, "stdio-child.mjs");
  await writeFile(script, `
import { bootstrapCore } from ${JSON.stringify(new URL("./bootstrap.mjs", import.meta.url).href)};
import { fixtureKeyring } from ${JSON.stringify(new URL("./fixtures/encrypted-keyring.mjs", import.meta.url).href)};
const { did, server } = await bootstrapCore({ packageDir: ${JSON.stringify(packageDir)}, dataDir: process.env.SEALBRIDGE_DATA_DIR,
  keyringLoader: async () => fixtureKeyring(process.env.SEALBRIDGE_DATA_DIR) });
await (await import("node:fs/promises")).writeFile(process.env.SEALBRIDGE_DATA_DIR + "/child-home.json", JSON.stringify(process.env.HOME));
process.send({ type: "identity", did });
await server.serve(process.stdin, process.stdout);
const { readdir, readFile, writeFile } = await import("node:fs/promises");
const path = (await import("node:path")).default;
${files.toString()}
const record = new (fixtureKeyring(process.env.SEALBRIDGE_DATA_DIR).Entry)("fixture", "requester", { linux: { store: "secret-service" } }).getPassword();
const key = JSON.parse(record);
for (const bytes of await files(process.env.HOME)) {
  if ([record, ...["d", "p", "q", "dp", "dq", "qi", "k"].map(field => key[field]).filter(Boolean), ["PRIVATE", "KEY"].join(" ")].some(value => bytes.includes(Buffer.from(value))) || /"(?:kty|d)"\\s*:/.test(bytes.toString())) throw new Error("Fixture home contains key material");
}
await writeFile(path.join(process.env.SEALBRIDGE_DATA_DIR, "home-checked"), "checked");
process.disconnect();
`);
  const logs = [], replies = [], homes = [];
  async function launch() {
    let host;
    const service = createCoreService({ dataDir: dir, hostFactory: options => {
      host = new McpHost({ ...options, cliEntry: script });
      return host;
    } });
    t.after(() => service.close());
    await service.start();
    const handlers = new Map();
    registerCoreIpc({ service, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      localOnly: (_name, handler) => handler });
    const publicState = await handlers.get("sealbridge:status")();
    replies.push(JSON.stringify(publicState));
    assert.equal(publicState.state, "ready");
    assert.deepEqual(Object.keys(publicState).sort(), ["did", "state", "version"]);
    logs.push(host.stderr);
    const home = JSON.parse(await readFile(path.join(dir, "child-home.json"), "utf8"));
    homes.push(...await files(home));
    await service.close();
    assert.equal(await readFile(path.join(dir, "home-checked"), "utf8"), "checked");
    await rm(path.join(dir, "home-checked"));
    return publicState.did;
  }
  assert.equal(await launch(), await launch());
  const secretRecord = new (fixtureKeyring(dir).Entry)("fixture", "requester", { linux: { store: "secret-service" } }).getPassword();
  const secret = JSON.parse(secretRecord).d;
  for (const bytes of [...await files(dir), ...homes, ...[...replies, ...logs].map(value => Buffer.from(value))]) {
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    assert.equal(bytes.includes(Buffer.from(secretRecord)), false);
    assert.equal(bytes.includes(Buffer.from("PRIVATE KEY")), false);
  }
});
