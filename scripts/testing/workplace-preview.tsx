import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { initialState } from "../../src/state/store";
import { setAnalyticsEnabled, setEmailGateDone } from "../../src/lib/analytics";
import { markSimpleModePromptSeen } from "../../src/lib/simple-mode-prompt";
import { applySkinChoice, readSkinChoice } from "../../src/lib/skins";
import type { WorkplaceBridge } from "../../shared/sealbridge";
import "../../src/styles.css";

const agent = `did:key:z${"a".repeat(48)}`;
const workplace = Object.fromEntries(["settings", "save", "select", "find", "test", "verify", "status", "prepare", "decide", "validateOwnerText"].map(method => [method, async (...args: unknown[]) => {
  const response = await fetch("/__workplace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, args }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}])) as unknown as WorkplaceBridge;
Object.assign(window, { ogb: { sealbridge: {
  workplace, status: async () => ({ state: "ready", did: agent, version: "fixture" }),
  contextRecipients: async () => [{ id: "fixture-peer", name: "相手の fixture", did: "did:key:fixture-peer", state: "connected" }],
  receiveStatus: async () => ({ state: "ready", rows: [], compose: [], rejected: [], approvals: [] }),
  contextStatus: async () => ({ state: "idle" }), receivedAudits: async () => [], invites: async () => [],
} } });
setAnalyticsEnabled(false); setEmailGateDone("skipped"); markSimpleModePromptSeen(); applySkinChoice(readSkinChoice());
initialState.selectedId = new URLSearchParams(location.search).get("bot") ?? "";
createRoot(document.getElementById("root")!).render(<App />);
