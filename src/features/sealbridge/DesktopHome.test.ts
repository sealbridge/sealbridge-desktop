// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DesktopHome } from "./DesktopHome";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), identity: undefined as undefined | { state: string; did: string } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { profile: { name: "Fixture" } } }, dispatch: fixture.dispatch }) }));
vi.mock("./useIdentity", () => ({ useIdentity: () => fixture.identity }));
vi.mock("./context-pooling/ContextPoolingView", () => ({ ContextPoolingView: () => createElement("textarea", { "aria-label": "fixture draft" }) }));

it("keeps requests and work above identity and connections without inventing state", () => {
  const host = document.createElement("div"), root = createRoot(host);
  try {
    fixture.identity = undefined;
    flushSync(() => root.render(createElement(DesktopHome, { inbox: false })));
    expect([...host.querySelectorAll("h2")].map(node => node.textContent)).toEqual(["開くのを待っている依頼", "進行中の仕事", "自分のエージェント", "つながり"]);
    expect(host.textContent).toContain("未確認");
    expect(host.textContent).not.toContain("接続済み");
    expect(host.textContent).not.toContain("0 件");
    expect(host.textContent).toContain("この版では署名を確認したつながりの総数");
    host.querySelector("button")!.click();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showInbox" });
    const draft = host.querySelector("textarea")!;
    draft.value = "fixture-only draft";
    flushSync(() => root.render(createElement(DesktopHome, { inbox: true })));
    expect(host.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("fixture-only draft");
  } finally { flushSync(() => root.unmount()); }
});

it("shows one confirmed identity with a short address until details open", () => {
  const host = document.createElement("div"), root = createRoot(host);
  fixture.identity = { state: "ready", did: "did:key:fixture-long-public-address" };
  try {
    flushSync(() => root.render(createElement(DesktopHome, { inbox: false })));
    expect(host.textContent).not.toContain(fixture.identity.did);
    flushSync(() => [...host.querySelectorAll("button")].find(button => button.textContent === "届け先の詳細")!.click());
    expect(host.textContent).toContain(fixture.identity.did);
  } finally { flushSync(() => root.unmount()); }
});
