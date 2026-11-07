// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ContextSendPanel } from "./ContextSendPanel";
import { ContextPoolingView } from "./ContextPoolingView";
import { defaultContextDraft } from "../../../../shared/context-pooling";

it("shows the actual approval projection, Enter cannot approve, explicit decisions and cancellation use IPC", async () => {
  vi.useFakeTimers();
  const previous = window.ogb;
  const answerContext = vi.fn(), cancelContext = vi.fn();
  const card = { id: 7, gate: "contract_acceptance", recipient: "did:key:fixture…peer", mode: "view_only", angle: "可否",
    allowedCount: 2, deniedCount: 1, bytes: 123, expiresAt: "2099-01-01", digest: "ab".repeat(32) };
  const bridge = { contextRecipients: vi.fn().mockResolvedValue([]),
    contextStatus: vi.fn().mockResolvedValue({ state: "approval", approval: card }), answerContext, cancelContext };
  Object.assign(window, { ogb: { sealbridge: bridge } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextSendPanel, { draft: defaultContextDraft(), ready: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host.textContent).toContain(card.digest);
    for (const value of [card.recipient, card.angle, "123 バイト", "許可する列 2", "拒否する列 1"]) expect(host.textContent).toContain(value);
    const approve = [...host.querySelectorAll("button")].find(button => button.textContent === "この内容で送る")!;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    approve.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true); expect(answerContext).not.toHaveBeenCalled();
    approve.click(); expect(answerContext).toHaveBeenLastCalledWith(7, true);
    [...host.querySelectorAll("button")].find(button => button.textContent === "拒否する")!.click();
    expect(answerContext).toHaveBeenLastCalledWith(7, false);
    [...host.querySelectorAll("button")].find(button => button.textContent === "中止")!.click();
    expect(cancelContext).toHaveBeenCalledOnce();
    bridge.contextStatus.mockResolvedValue({ state: "approval", approval: { ...card, gate: "final_verification" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host.textContent).toContain("納品の最終確認");
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); vi.useRealTimers(); }
});

it("shows the second hop and a peer rejection without sending again", async () => {
  vi.useFakeTimers();
  const previous = window.ogb;
  const startContext = vi.fn();
  const card = { id: 3, gate: "final_verification", recipient: "did:key:fixture…peer", mode: "approval_redelegation", angle: "可否",
    allowedCount: 1, deniedCount: 1, bytes: 4, expiresAt: "2099-01-01", digest: "cd".repeat(32), delegateeOwnerDids: ["did:key:child…00000000"] };
  const bridge = { contextRecipients: vi.fn().mockResolvedValue([]), contextStatus: vi.fn().mockResolvedValue({ state: "approval", approval: card }),
    startContext, answerContext: vi.fn(), cancelContext: vi.fn(), resetContext: vi.fn() };
  Object.assign(window, { ogb: { sealbridge: bridge } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextSendPanel, { draft: { ...defaultContextDraft(), deliveryMode: "approval_redelegation" }, ready: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host.textContent).toContain("2段目の相手 did:key:child…00000000");
    expect(host.textContent).toContain("納品の最終確認");
    bridge.contextStatus.mockResolvedValue({ state: "failed", peerRejected: true, delegateeOwnerDids: card.delegateeOwnerDids });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(host.textContent).toContain("相手の版が持ち寄りに対応していない可能性があります");
    expect(host.textContent).toContain("2段目の相手 did:key:child…00000000");
    expect(startContext).not.toHaveBeenCalled();
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); vi.useRealTimers(); }
});

it("draft body stays outside renderer storage and logging and its input disables spelling", async () => {
  const previous = window.ogb;
  const marker = "DW1_RENDERER_" + "TRANSIENT_MARKER";
  const writes: unknown[] = [];
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation((...args) => { writes.push(args); });
  const log = vi.spyOn(console, "log").mockImplementation((...args) => { writes.push(args); });
  const info = vi.spyOn(console, "info").mockImplementation((...args) => { writes.push(args); });
  const warn = vi.spyOn(console, "warn").mockImplementation((...args) => { writes.push(args); });
  const error = vi.spyOn(console, "error").mockImplementation((...args) => { writes.push(args); });
  Object.assign(window, { ogb: { sealbridge: { prepareContext: vi.fn() } } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextPoolingView)));
    const body = host.querySelector<HTMLTextAreaElement>('textarea[rows="6"]')!;
    expect(body.getAttribute("spellcheck")).toBe("false");
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(body, marker);
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(body.value === marker).toBe(true);
    for (const source of ["ContextPoolingView.tsx", "ContextSendPanel.tsx"]) {
      expect(/localStorage|sessionStorage|indexedDB/.test(readFileSync(`src/features/sealbridge/context-pooling/${source}`, "utf8"))).toBe(false);
    }
    expect(JSON.stringify(writes).includes(marker)).toBe(false);
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); storage.mockRestore(); log.mockRestore(); info.mockRestore(); warn.mockRestore(); error.mockRestore(); }
});
