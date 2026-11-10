// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InvitePasteButton } from "./InvitePasteButton";

it("is absent in a browser and sends clipboard import only through Electron's bridge", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const original = window.ogb;
  try {
    Object.assign(window, { ogb: undefined });
    flushSync(() => root.render(createElement(InvitePasteButton)));
    expect(host.querySelector("button")).toBeNull();
    const pasteInvite = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(window, { ogb: { sealbridge: { pasteInvite } } });
    flushSync(() => root.render(createElement(InvitePasteButton)));
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("招待を確認しています"));
    expect(pasteInvite).toHaveBeenCalledWith();
  } finally {
    flushSync(() => root.unmount());
    Object.assign(window, { ogb: original });
  }
});
