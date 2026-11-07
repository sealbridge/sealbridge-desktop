// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ContextReceivePanel } from "./ContextReceivePanel";
import type { ContextReceiveStatus } from "../../../../shared/sealbridge";

it("renders literal preview, refuses Enter opening and requires answer confirmation without persistence", async () => {
  const previous = window.ogb;
  const receiveAction = vi.fn().mockResolvedValue({ ok: true }), receiveReply = vi.fn().mockResolvedValue({ ok: true });
  const summary = { mode: "view_only" as const, angle: "可否だけ", allowedCount: 0, deniedCount: 0,
    bytes: 10, expiresAt: "2099-01-01T00:00:00Z", retention: "none" as const, digest: "fixture" };
  const status: ContextReceiveStatus = { state: "ready", rows: [{ id: "held", taskId: "task", sender: "peer", state: "reviewable",
    inspectionStatus: "complete", expiresAt: Date.now() + 100000, preview: "<img src=x onerror=alert(1)> **literal**", canOpen: true, summary }],
    compose: [{ id: 2, taskId: "task", summary }], rejected: [] };
  const store = vi.spyOn(Storage.prototype, "setItem");
  const consoleLog = vi.spyOn(console, "log");
  Object.assign(window, { ogb: { sealbridge: { receiveStatus: vi.fn().mockResolvedValue(status), receiveAction, receiveReply } } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextReceivePanel)));
    await vi.waitFor(() => expect(host.textContent).toContain("判断待ち"));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain(status.rows[0].preview);
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === "開く")!;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(receiveAction).not.toHaveBeenCalled();
    button.click();
    expect(receiveAction).toHaveBeenCalledWith("held", "open");
    const area = host.querySelector("textarea")!;
    expect(area.getAttribute("spellcheck")).toBe("false");
    expect(area.autocomplete).toBe("off");
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "手入力の答え");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(receiveReply).not.toHaveBeenCalled();
    flushSync(() => [...host.querySelectorAll("button")].find(item => item.textContent === "答えを確認")!.click());
    expect(host.textContent).toContain("この答えを送ります");
    expect(receiveReply).not.toHaveBeenCalled();
    flushSync(() => [...host.querySelectorAll("button")].find(item => item.textContent === "この答えを送る")!.click());
    await vi.waitFor(() => expect(receiveReply).toHaveBeenCalledWith(2, "手入力の答え"));
    expect(store).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); vi.restoreAllMocks(); }
});

it.each(["error", "unavailable", "pending"])("never offers opening for %s inspection", async inspectionStatus => {
  const previous = window.ogb;
  Object.assign(window, { ogb: { sealbridge: { receiveStatus: async () => ({ state: "ready", rows: [
    { id: "held", taskId: "task", sender: "peer", state: "held", inspectionStatus, canOpen: false },
  ], compose: [], rejected: [] }) } } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextReceivePanel)));
    await vi.waitFor(() => expect(host.querySelector("article")).not.toBeNull());
    expect([...host.querySelectorAll("button")].find(item => item.textContent === "開く")!.disabled).toBe(true);
    if (inspectionStatus !== "pending") expect(host.textContent).toContain("検査できませんでした。この依頼は保留です。");
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); }
});

it("requires a narrower extract before asking the next owner", async () => {
  const previous = window.ogb;
  const receiveNarrow = vi.fn().mockResolvedValue({ ok: true });
  const marker = "DW4_FORM_" + "TRANSIENT_MARKER";
  const status: ContextReceiveStatus = { state: "ready", rows: [], compose: [], rejected: [], redelegation: {
    id: 4, taskId: "parent", parent: { angle: "可否", selectors: ["one", "two"], fieldsAllowed: ["x", "y"], fieldsDenied: ["private"], body: marker },
    recipients: [{ id: "peer-1", name: "相手", did: "did:key:child…00000000" }] } };
  const store = vi.spyOn(Storage.prototype, "setItem");
  Object.assign(window, { ogb: { sealbridge: { receiveStatus: vi.fn().mockResolvedValue(status), receiveNarrow } } });
  const host = document.createElement("div"), root = createRoot(host);
  const setValue = (element: HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  };
  try {
    flushSync(() => root.render(createElement(ContextReceivePanel)));
    await vi.waitFor(() => expect(host.textContent).toContain("ほかの相手へ、狭めて頼む"));
    const submit = [...host.querySelectorAll("button")].find(item => item.textContent === "この範囲で頼む")!;
    expect(submit.disabled).toBe(true);
    for (const area of host.querySelectorAll("textarea")) expect(area.getAttribute("spellcheck")).toBe("false");
    const [selectors, allowed] = [...host.querySelectorAll("textarea")] as HTMLTextAreaElement[];
    flushSync(() => { setValue(selectors, "one"); setValue(allowed, "x"); setValue(host.querySelector("select")!, "peer-1"); });
    expect(submit.disabled).toBe(false);
    flushSync(() => submit.click());
    expect(receiveNarrow).toHaveBeenCalledWith({ id: 4, recipientId: "peer-1", selectors: ["one"], fieldsAllowed: ["x"],
      fieldsDenied: ["private"], angle: "可否", body: marker, discloseRoot: false });
    expect(store).not.toHaveBeenCalled();
    expect(JSON.stringify(store.mock.calls).includes(marker)).toBe(false);
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); vi.restoreAllMocks(); }
});

it("receive implementation never interprets markup or persists input and answers", () => {
  for (const file of ["src/features/sealbridge/context-pooling/ContextReceivePanel.tsx", "electron/sealbridge/context-receive-core.mjs", "electron/sealbridge/context-receive.mjs", "electron/sealbridge/context-receive-child.mjs"]) {
    expect(readFileSync(file, "utf8")).not.toMatch(/dangerouslySetInnerHTML|localStorage|sessionStorage|indexedDB|console\./);
  }
});
