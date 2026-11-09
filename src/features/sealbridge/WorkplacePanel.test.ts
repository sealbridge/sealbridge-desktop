// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopHome } from "./DesktopHome";
import { WorkplacePanel } from "./WorkplacePanel";
import { WorkplaceApproval } from "./WorkplaceApproval";
import { WorkplaceSettings } from "./WorkplaceSettings";
import { workplaceExamples, emptyWorkplace } from "./workplace-presets";
import type { WorkplaceBridge, WorkplaceDecision, WorkplaceSettings as Settings } from "../../../shared/sealbridge";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), append: vi.fn(), agent: "did:key:zfixture", state: { selectedId: "retained", bots: [{ id: "retained", threadId: "old-thread", messages: [{ id: "old", text: "以前の会話" }] }] } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/drafts", () => ({ appendComposerDraft: fixture.append }));
vi.mock("./useIdentity", () => ({ useIdentity: () => ({ state: "ready", did: fixture.agent }) }));
vi.mock("./context-pooling/ContextPoolingView", () => ({ ContextPoolingView: () => createElement("select", { "aria-label": "つながっている相手を選ぶ" }, createElement("option", null, "相手")) }));

const definition = { ...emptyWorkplace(), ...workplaceExamples[1].values, id: "fixture", cwd: "C:\\fixture" };
const settings: Settings = { definitions: [definition], agents: { "did:key:zfixture": ["fixture"] }, verified: { fixture: { version: "fixture v1", scope: true, noRecord: true, stdin: true, stop: true } } };
const card: WorkplaceDecision = { id: "approval", action: "launch", name: "任意の作業場", executable: "C:\\fixture.exe", version: "fixture v1", cwd: "C:\\fixture", scope: "未確認", retention: "記録が残ります", level: 0 };
let bridge: WorkplaceBridge;
beforeEach(() => {
  vi.clearAllMocks();
  bridge = { validateOwnerText: vi.fn(async () => true), settings: vi.fn(async () => settings), find: vi.fn(async () => "C:\\fixture.exe"), save: vi.fn(async () => settings), select: vi.fn(async () => settings),
    test: vi.fn(async () => settings), verify: vi.fn(async () => settings), status: vi.fn(async () => []), prepare: vi.fn(async () => card), decide: vi.fn(async () => {}) };
  Object.assign(window, { ogb: { sealbridge: { workplace: bridge } } });
});
async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  await act(async () => root.render(node));
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button = (host: Element, text: string) => [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
const click = async (host: Element, text: string) => { await act(async () => button(host, text).click()); };
const fill = async (input: HTMLTextAreaElement, text: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

it("home and inbox never discover or launch; only own detail exposes the workplace; recipient selection remains", async () => {
  const view = await mount(createElement(DesktopHome, { inbox: false }));
  try {
    expect(view.host.textContent).not.toContain("作業場の設定");
    expect(bridge.find).not.toHaveBeenCalled(); expect(bridge.prepare).not.toHaveBeenCalled();
    await click(view.host, "受信箱で確認する");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showInbox" });
    expect(view.host.querySelector('select[aria-label="つながっている相手を選ぶ"]')).not.toBeNull();
    expect(bridge.find).not.toHaveBeenCalled();
    await click(view.host, "届け先の詳細");
    expect(view.host.textContent).toContain("作業場の設定");
    expect(bridge.find).toHaveBeenCalledWith("fixture");
    await click(view.host, "Desktop 内の作業場を開く");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showChat" });
    expect(fixture.state.bots[0].messages[0].text).toBe("以前の会話");
    expect(fixture.append).not.toHaveBeenCalled(); expect(bridge.decide).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it("the named launch button prepares only; two-choice launch approval is required", async () => {
  const view = await mount(createElement(WorkplacePanel, { agent: fixture.agent }));
  try {
    expect(button(view.host, "Codex へ渡す前に確認").disabled).toBe(true);
    await click(view.host, "Codex を起こす前に確認");
    expect(bridge.prepare).toHaveBeenCalledWith(expect.objectContaining({ action: "launch", level: 0 }));
    expect(bridge.decide).not.toHaveBeenCalled();
    const dialog = view.host.querySelector('[role="dialog"]')!;
    expect([...dialog.querySelectorAll("button")].map(b => b.textContent)).toEqual(["やめる", "起こす"]);
    expect(dialog.textContent).toContain("依頼の本文はまだ渡しません");
    await click(view.host, "起こす");
    expect(bridge.decide).toHaveBeenCalledWith("approval", true);
  } finally { await view.close(); }
});

it("internal handoff shares the full-text confirmation and never forwards by opening", async () => {
  const view = await mount(createElement(WorkplacePanel, { agent: "internal-owner" }));
  try {
    await click(view.host, "Desktop 内の作業場を開く");
    const text = "自分の下書き\n全文をそのまま";
    await fill(view.host.querySelector("textarea")!, text);
    await click(view.host, "Desktop 内の作業場へ渡す前に確認");
    expect(fixture.append).not.toHaveBeenCalled();
    expect(view.host.querySelector('[role="dialog"] pre')!.textContent).toBe(text);
    await click(view.host, "渡す");
    expect(fixture.append).toHaveBeenCalledWith("bot:retained:old-thread", text);
    expect(bridge.prepare).not.toHaveBeenCalled(); expect(bridge.decide).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it("T3 is a stage-zero example and has no handoff button; examples and custom binding share editable fields", async () => {
  const t3 = { ...emptyWorkplace(), ...workplaceExamples[2].values, id: "t3", cwd: "C:\\fixture" };
  vi.mocked(bridge.settings).mockResolvedValue({ definitions: [t3], agents: { [fixture.agent]: [t3.id] }, verified: {} });
  const view = await mount(createElement(WorkplacePanel, { agent: fixture.agent }));
  try {
    expect(view.host.textContent).not.toContain("T3 へ渡す");
    expect(view.host.textContent).toContain("Full access");
    await click(view.host, "作業場の設定");
    await click(view.host, "自分で紐付ける");
    expect([...view.host.querySelectorAll("label")].some(label => label.textContent!.startsWith("実行ファイル"))).toBe(true);
    expect(view.host.textContent).toContain("引数（1行に1件）");
    await click(view.host, "Claude Code");
    expect((view.host.querySelector('fieldset input') as HTMLInputElement).value).toBe("Claude Code");
    expect(bridge.test).not.toHaveBeenCalled(); expect(bridge.decide).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it("version probing has its own explicit execution confirmation", async () => {
  const view = await mount(createElement(WorkplaceSettings, { bridge, settings, agent: fixture.agent, onSettings: vi.fn() }));
  try {
    await click(view.host, "所有者が確認して試す（版を読む）");
    expect(bridge.test).not.toHaveBeenCalled();
    await click(view.host, "確認して試す");
    expect(bridge.test).toHaveBeenCalledWith("fixture");
  } finally { await view.close(); }
});

it("pass and stop cards have two decisions, exact text and honest retention wording", async () => {
  const full = "自分の全文\n削らずに表示";
  const pass = await mount(createElement(WorkplaceApproval, { card: { ...card, action: "pass", text: full, level: 1, source: "owner-draft" }, onDecision: vi.fn() }));
  try {
    expect(pass.host.querySelector("pre")!.textContent).toBe(full);
    expect([...pass.host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["渡さない", "渡す"]);
    expect(pass.host.textContent).toContain("モデル提供者");
  } finally { await pass.close(); }
  const stop = await mount(createElement(WorkplaceApproval, { card: { ...card, action: "stop" }, onDecision: vi.fn() }));
  try {
    expect([...stop.host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["続ける", "止める"]);
    expect(stop.host.textContent).toContain("削除の証明にはなりません");
    expect(stop.host.textContent).not.toContain("常に許可");
  } finally { await stop.close(); }
});
