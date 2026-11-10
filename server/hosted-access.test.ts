import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { HOSTED_WORKSPACE_UNSUPPORTED, hostedWorkspaceConfiguration } from "./workspace-policy.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";

let child: ChildProcess | undefined;
let directory: string | undefined;
afterEach(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  child = undefined;
  if (directory) await removeTempDir(directory);
  directory = undefined;
});

async function fixture(settings: NodeJS.ProcessEnv, ownerTrust = true) {
  directory = mkdtempSync(join(tmpdir(), "oss-hosted-access-"));
  mkdirSync(join(directory, "tmp"));
  writeFileSync(join(directory, "config.json"), JSON.stringify({
    features: { smartSetupChoices: false },
    instances: { claude: { driver: "claudeAgent", config: { cli: fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url)) } } },
  }));
  const sessions = new SessionRegistry({ file: join(directory, "sessions.json"), portalMembership: true });
  const local = sessions.issue({ label: "Fixture member", scopes: ["client"] });
  const portal = sessions.issuePortal({ email: "member@example.test", grant: "g".repeat(43), scopes: ["client"] });
  sessions.close();
  const layer = join(directory, "external-layer");
  const marker = join(directory, "executed");
  mkdirSync(join(layer, "server"), { recursive: true });
  writeFileSync(join(layer, "server", "index.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "executed"); export function register() { return { features: ["admin"] }; }`);
  const port = await freePortBlock([0, 1]);
  const env = { ...verificationServerEnvironment(process.env, directory, port),
    ...(ownerTrust ? { OMB_LOOPBACK_TRUST: "owner" } : {}),
    ...settings,
    ...(settings.OMB_ENTERPRISE_DIR ? { OMB_ENTERPRISE_DIR: layer } : {}),
  };
  const url = `http://127.0.0.1:${port}`;
  const evidenceDir = join(tmpdir(), "openmausbot-verification-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(evidenceDir, `hosted-access-${Date.now()}-${port}.log`);
  const log = openSync(logPath, "a", 0o600);
  child = spawn(process.execPath, verificationServerArgs(env), { env, stdio: ["ignore", log, log] });
  closeSync(log);
  let spawnError: Error | undefined;
  child.on("error", error => { spawnError = error; });
  try {
    await expect.poll(async () => {
      if (spawnError) throw spawnError;
      if (child?.exitCode !== null || child?.signalCode !== null) throw new Error(readFileSync(logPath, "utf8"));
      try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) })).status; }
      catch { return 0; }
    }, { timeout: 20_000, interval: 100 }).toBe(200);
  } catch (error) {
    throw new Error(`${String(error)}\n${readFileSync(logPath, "utf8")}`);
  }
  console.info(JSON.stringify({ url, logPath }));
  return {
    localToken: local.token, portalToken: portal.token, marker, logPath,
    async request(path: string, options: RequestInit = {}) {
      const response = await fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5_000) });
      appendFileSync(logPath, `fixture: ${options.method ?? "GET"} ${path} -> ${response.status}\n`);
      return response;
    },
  };
}

const hostedSettings: NodeJS.ProcessEnv[] = [
  ...["OMB_ADMIN_URL", "OMB_ADMIN_WORKSPACE", "OMB_ADMIN_MEMBERSHIP"].flatMap(key => ["", "invalid"].map(value => ({ [key]: value }))),
  ...["portal", "local"].map(membership => ({
    OMB_ADMIN_URL: "https://admin.example.test", OMB_ADMIN_WORKSPACE: "acme",
    OMB_ADMIN_MEMBERSHIP: membership, OMB_PUBLIC_URL: "https://workspace.example.test",
  })),
];
it.each(hostedSettings)("keeps local owner access and refuses hosted routes with configuration %j", async settings => {
  const server = await fixture(settings);
  expect((await server.request("/api/config")).status).toBe(200);
  const config = await server.request("/api/config", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "ja" }),
  });
  expect(config.status).toBe(200);
  expect(await (await server.request("/api/config")).json()).toMatchObject({ language: "ja" });
  for (const path of ["/api/health/hosted", "/api/auth/hosted/start", "/api/auth/hosted/callback", "/pair"]) {
    const response = await server.request(path);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: HOSTED_WORKSPACE_UNSUPPORTED });
  }
  const remote = await server.request("/", { headers: { "x-forwarded-host": "workspace.example.test", "x-forwarded-proto": "https" } });
  expect(remote.status).toBe(503);
  expect(await remote.json()).toEqual({ error: HOSTED_WORKSPACE_UNSUPPORTED });
  for (const path of ["/api/auth/pair", "/api/pair", "/api/auth/pairing", "/api/auth/email/start", "/api/auth/email/verify"]) {
    const response = await server.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: HOSTED_WORKSPACE_UNSUPPORTED });
  }
  for (const [token, status] of [[server.localToken, 503], [server.portalToken, hostedWorkspaceConfiguration(settings)?.portalMembership ? 503 : 401]] as const) {
    const response = await server.request("/api/bots", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(status);
    if (response.status === 503) expect(await response.json()).toEqual({ error: HOSTED_WORKSPACE_UNSUPPORTED });
  }
}, 30_000);

it("keeps the existing hosted service trust default", async () => {
  const server = await fixture({ OMB_ADMIN_URL: "" }, false);
  expect((await server.request("/api/config")).status).toBe(403);
}, 30_000);

it.each<NodeJS.ProcessEnv>([
  { OMB_LICENSE_KEY: "" }, { OMB_LICENSE_KEY: "fixture-private-value" },
  { OMB_ENTERPRISE_DIR: "" }, { OMB_ENTERPRISE_DIR: "fixture-layer" },
  { OMB_LICENSE_KEY: "fixture-private-value", OMB_ENTERPRISE_DIR: "fixture-layer" },
])("continues as OSS and logs a notice for ignored settings %j", async settings => {
  const server = await fixture(settings);
  const response = await server.request("/api/edition");
  expect(response.status).toBe(200);
  const status = await response.json() as { notice: string };
  const keys = Object.keys(settings);
  const notice = `${keys.join(", ")} ${keys.length === 1 ? "has" : "have"} no effect in this distribution.`;
  expect(status).toEqual({ edition: "oss", features: [], notice });
  expect(readFileSync(server.logPath, "utf8")).toContain(`Sealbridge Desktop open-source edition (${notice})`);
  expect(JSON.stringify(status)).not.toContain("fixture-private-value");
  expect(existsSync(server.marker)).toBe(false);
  const member = await server.request("/api/edition", { headers: { authorization: `Bearer ${server.localToken}` } });
  expect(member.status).toBe(200);
  expect(await member.json()).toEqual({ edition: "oss", features: [] });
  const config = await server.request("/api/config");
  expect(config.status).toBe(200);
  expect((await config.json() as { edition: unknown }).edition).toEqual({ edition: "oss", features: [] });
  const pairing = await server.request("/api/auth/pairing", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(pairing.status).toBe(200);
  const { credential } = await pairing.json() as { credential: string };
  expect((await server.request("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) })).status).toBe(200);
}, 30_000);
