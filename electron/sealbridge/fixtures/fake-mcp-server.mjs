import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const { mode, urlScheme } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const lines = createInterface({ input: process.stdin });
let initialized = false;
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
if (mode === "hang") {
  process.stdin.pause();
  setInterval(() => {}, 1000);
} else lines.on("line", line => {
  const frame = JSON.parse(line);
  if (frame.method === "notifications/initialized") { initialized = true; return; }
  if (mode === "garbage") { process.stdout.write("not json\n"); return; }
  if (mode === "invalid") { send({ jsonrpc: "2.0", id: frame.id, result: {}, error: {} }); return; }
  if (mode === "oversized") { process.stdout.write("x".repeat(5000)); return; }
  if (mode === "exit") { process.exit(1); }
  if (mode === "slow") return;
  let result = {};
  if (frame.method === "initialize") result = { protocolVersion: "2024-11-05", serverInfo: { name: "fixture", version: "0.6.3" }, capabilities: {} };
  if (frame.method === "tools/list") {
    if (!initialized) { send({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "not initialized" } }); return; }
    result = { tools: [{ name: "acp_discover_workers" }] };
  }
  if (frame.method === "fixture/environment") result = process.env;
  if (frame.method === "fixture/stderr") {
    process.stderr.write("acp-invi");
    process.stderr.write(`te:fixture-only acp://invite/fixture-only ${urlScheme}://invite#fixture-only\n`);
    process.stderr.write('privateKey="fixture-key"\n-----BEGIN PRIVATE KEY-----\nfixture-key\n-----END PRIVATE KEY-----\n');
    process.stderr.write("z".repeat(10000));
  }
  if (frame.method === "fixture/rpc-error") { send({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "acp-invite:fixture-only" } }); return; }
  if (frame.method === "fixture/garbage") { process.stdout.write("invalid\n"); return; }
  if (frame.method === "fixture/slow") return;
  if (frame.method === "fixture/exit-record") writeFileSync(new URL("./called.txt", import.meta.url), "called");
  if (mode === "split") {
    const response = JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) + "\r\n";
    process.stdout.write(response.slice(0, 9));
    setTimeout(() => process.stdout.write(response.slice(9)), 5);
  } else if (frame.method === "fixture/concurrent") {
    setTimeout(() => send({ jsonrpc: "2.0", id: frame.id, result: frame.params }), frame.params.delay);
  } else send({ jsonrpc: "2.0", id: frame.id, result });
});
