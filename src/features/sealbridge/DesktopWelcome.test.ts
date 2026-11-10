// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopWelcome } from "./DesktopWelcome";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn(), status: { state: "ready", did: "did:key:fixture" } as { state: string; did: string | null } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { profile: { name: "Fixture" } } }, dispatch: fixture.dispatch }), api: fixture.api }));
vi.mock("./useIdentity", () => ({ useIdentity: () => fixture.status }));
afterEach(() => { vi.clearAllMocks(); });

it("finishes without any workplace or model and only after the completion saves", async () => {
  fixture.status = { state: "ready", did: "did:key:fixture" };
  fixture.api.mockResolvedValue({ onboarding: { completedAt: "fixture" } });
  const host = document.createElement("div"), root = createRoot(host), done = vi.fn();
  try {
    flushSync(() => root.render(createElement(DesktopWelcome, { onDone: done })));
    expect(host.querySelector("h1")?.textContent).toBe("Sealbridge Desktop");
    expect(host.textContent).toContain("公開アドレス");
    expect(host.textContent).toContain("アプリ内のチャットを開きます");
    expect(host.textContent).toContain("ホストされた作業環境への登録ではありません");
    expect(host.textContent).toContain("あなたのエージェントの届け先を準備します。");
    flushSync(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("did:key:fixture");
    const home = [...host.querySelectorAll("button")].find(button => button.textContent === "ホームを見る")!;
    home.click();
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showHome" });
    expect(fixture.api).toHaveBeenCalledTimes(1);
  } finally { flushSync(() => root.unmount()); }
});

it("cannot finish with an unusable key store", () => {
  fixture.status = { state: "key-store-unavailable", did: null };
  const host = document.createElement("div"), root = createRoot(host), done = vi.fn();
  try {
    flushSync(() => root.render(createElement(DesktopWelcome, { onDone: done })));
    flushSync(() => host.querySelector("button")!.click());
    const home = [...host.querySelectorAll("button")].find(button => button.textContent === "ホームを見る")!;
    expect(home.disabled).toBe(true);
    home.click();
    expect(done).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); }
});
