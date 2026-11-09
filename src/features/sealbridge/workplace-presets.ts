import type { WorkplaceDefinition } from "../../../shared/sealbridge";

export function emptyWorkplace(): WorkplaceDefinition {
  return { id: crypto.randomUUID(), name: "", executable: "", args: [], cwd: "", versionArgs: ["--version"], scopeArgs: [], scopeDescription: "", noRecordArgs: [], stdin: "none", stop: "terminate", retention: "unknown" };
}

export const workplaceExamples: { label: string; values: Partial<WorkplaceDefinition> }[] = [
  { label: "Claude Code", values: { name: "Claude Code", executable: "claude", args: ["-p"],
    scopeArgs: ["--tools", "Read,Glob,Grep", "--permission-mode", "dontAsk", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disallowedTools", "mcp__*"],
    scopeDescription: "Read,Glob,Grep / dontAsk / 空の MCP 指定。WebFetch・WebSearch・Bash は含みません。--bare は使いません。作業フォルダやユーザー設定の hooks・MCP が動く可能性は未確認です。",
    noRecordArgs: ["--no-session-persistence"], stdin: "text-eof", stop: "interrupt-terminate", retention: "retained" } },
  { label: "Codex", values: { name: "Codex", executable: "codex", args: ["exec", "-"], scopeArgs: ["--sandbox", "read-only"],
    scopeDescription: "read-only を指定。ネットが閉じるか、すべての書き込みが止まるかは未確認です。", noRecordArgs: ["--ephemeral"], stdin: "text-eof", retention: "retained" } },
  { label: "T3", values: { name: "T3", executable: "t3", args: [], scopeDescription: "段0のみ。初めの既定は Full access。thread start の権限指定は未確認です。", stdin: "none", retention: "unknown" } },
];
