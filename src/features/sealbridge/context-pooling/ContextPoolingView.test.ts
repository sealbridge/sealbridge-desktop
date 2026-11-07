// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultContextDraft, selectionBytes, selectionError } from "../../../../shared/context-pooling";
import type { ContextGrantSummary } from "../../../../shared/context-pooling";
import { copy, modes } from "../../../../shared/context-pooling-copy.json";
import { ContextPoolingView } from "./ContextPoolingView";
import { GrantSummary } from "./GrantSummary";

it("counts the exact JSON input bytes and refuses more than 64 KiB or 7 days", () => {
  const draft = { ...defaultContextDraft(), body: "a", selectors: ["$.items"], angle: "可否だけ" };
  expect(draft.deliveryMode).toBe("view_only"); expect(draft.lifetimeHours).toBe(24);
  expect(selectionBytes("あ😀\n\"")).toBe(new TextEncoder().encode(JSON.stringify("あ😀\n\"")).length);
  expect(selectionError({ ...draft, body: "a".repeat(65534) })).toBeNull();
  expect(selectionError({ ...draft, body: "a".repeat(65535) })).toBe(copy.sizeError);
  expect(selectionError({ ...draft, lifetimeHours: 168 })).toBeNull();
  expect(selectionError({ ...draft, lifetimeHours: 169 })).toBe(copy.expiryError);
  expect(selectionError({ ...draft, lifetimeHours: 0 })).toBe(copy.expiredSend);
  expect(selectionError({ ...draft, deliveryMode: "approval_redelegation" })).toBeNull();
  expect(selectionError({ ...draft, deliveryMode: "other" as "view_only" })).toBe(copy.preparing);
});

it("keeps CP0 copy verbatim", () => {
  const source = readFileSync("shared/context-pooling-copy.json", "utf8");
  expect(source).toContain("相手の端末やモデルが、一度見た内容を残すことを、こちらの仕組みだけでは止められません。渡す範囲は小さく、期限は短くしてください。");
  const original = readFileSync("src/features/sealbridge/context-pooling/fixtures/cp0-copy.md", "utf8");
  for (const text of [...Object.values(copy), ...Object.values(modes).flatMap(mode => Object.values(mode))]) expect(original).toContain(text);
  expect(modes.approval_redelegation.badge).toBe("ほかへ可（1段・要承認）");
  expect(modes.hand_over.badge).toBe("引き渡し（納品は保持可）");
});

it("defaults to view only, offers approval redelegation, checks with SDK bridge and never sends", async () => {
  const previous = window.ogb, prepareContext = vi.fn();
  Object.assign(window, { ogb: { sealbridge: { prepareContext } } });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ContextPoolingView)));
    expect(host.textContent).toContain(copy.limit);
    expect(host.textContent).not.toContain("準備中");
    expect(host.textContent).not.toContain(copy.preparing);
    expect(host.querySelector<HTMLInputElement>('[value="view_only"]')!.checked).toBe(true);
    expect(host.textContent).toContain("閲覧のみでも、受け手の監査ファイルには答えの中身が残ります。");
    const approval = host.querySelector<HTMLInputElement>('[value="approval_redelegation"]')!;
    expect(approval.disabled).toBe(false); flushSync(() => approval.click());
    expect(host.querySelector<HTMLInputElement>('[value="approval_redelegation"]')!.checked).toBe(true);
    expect(host.textContent).toContain(copy.approvalExtra);
    expect(host.textContent).not.toContain("閲覧のみでも、受け手の監査ファイルには答えの中身が残ります。");
    expect(prepareContext).not.toHaveBeenCalled();
    for (const mode of Object.values(modes)) expect(host.textContent).toContain(mode.description);
    expect(Array.from(host.querySelectorAll("button")).find(b => b.textContent === "送る")!.disabled).toBe(true);
    flushSync(() => host.querySelector<HTMLInputElement>('[value="hand_over"]')!.click());
    expect(host.querySelector('[type="checkbox"]')).toBeNull();
    expect(host.textContent).not.toContain(copy.inputLabel);
    expect(host.textContent).toContain(copy.handOverExtra);
    expect(host.textContent).not.toContain("閲覧のみでも、受け手の監査ファイルには答えの中身が残ります。");
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); }
});

it.each(["view_only", "approval_redelegation", "hand_over"] as const)("renders %s receive badge, summary and pre-open limitation without input", mode => {
  const host = document.createElement("div"), root = createRoot(host);
  const summary: ContextGrantSummary = { mode, angle: "工程の可否だけ", allowedCount: 2, deniedCount: 1,
    bytes: 1024, expiresAt: "2026-11-02T00:00:00Z", retention: mode === "hand_over" ? "deliverable" : "none", digest: "0123456789abcdef" };
  try {
    flushSync(() => root.render(createElement(GrantSummary, { summary, beforeOpen: true, now: Date.parse("2026-11-01T00:00:00Z") })));
    for (const text of [modes[mode].badge, modes[mode].supplement, copy.limit, copy.open, "列 2件 · 拒否列 1件", "残り 24時間", "1.00 KB", summary.digest]) expect(host.textContent).toContain(text);
    expect(host.querySelector("textarea")).toBeNull();
  } finally { flushSync(() => root.unmount()); }
});

it("prepares the selected body with view_only and clears the summary after edits", async () => {
  const previous = window.ogb;
  const prepareContext = vi.fn().mockResolvedValue({ ok: true, summary: { mode: "view_only", angle: "可否だけ", allowedCount: 1,
    deniedCount: 0, bytes: 5, expiresAt: "2099-01-01T00:00:00Z", retention: "none", digest: "0123456789abcdef" } });
  Object.assign(window, { ogb: { sealbridge: { prepareContext } } });
  const host = document.createElement("div"), root = createRoot(host);
  const type = (area: HTMLTextAreaElement, text: string) => flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    flushSync(() => root.render(createElement(ContextPoolingView)));
    const areas = host.querySelectorAll("textarea");
    type(areas[0], "$.items"); type(areas[1], "size"); type(areas[3], "可否だけ"); type(areas[4], "本文");
    const check = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "送る前に確認")!;
    expect(check.disabled).toBe(false);
    flushSync(() => check.click());
    await vi.waitFor(() => expect(host.querySelector('[aria-label="grant 要約"]')).not.toBeNull());
    expect(prepareContext).toHaveBeenCalledExactlyOnceWith({ ...defaultContextDraft(), selectors: ["$.items"], fieldsAllowed: ["size"], angle: "可否だけ", body: "本文" });
    for (const area of Array.from(areas).slice(0, 3)) {
      flushSync(() => area.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      expect(host.querySelector('[aria-label="grant 要約"]')).not.toBeNull();
    }
    type(areas[0], "  $.items  \n\n");
    flushSync(() => areas[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(areas[0].value).toBe("$.items");
    expect(host.querySelector('[aria-label="grant 要約"]')).toBeNull();
    flushSync(() => check.click());
    await vi.waitFor(() => expect(host.querySelector('[aria-label="grant 要約"]')).not.toBeNull());
    type(areas[4], "変更した本文");
    expect(host.querySelector('[aria-label="grant 要約"]')).toBeNull();
  } finally { flushSync(() => root.unmount()); Object.assign(window, { ogb: previous }); }
});

it("refreshes remaining time every minute and clears the timer on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  const host = document.createElement("div"), root = createRoot(host);
  const summary: ContextGrantSummary = { mode: "view_only", angle: "可否だけ", allowedCount: 1, deniedCount: 0,
    bytes: 5, expiresAt: "2026-11-01T01:00:30Z", retention: "none", digest: "0123456789abcdef" };
  try {
    flushSync(() => root.render(createElement(GrantSummary, { summary })));
    expect(host.textContent).toContain("残り 2時間");
    flushSync(() => vi.advanceTimersByTime(60000));
    expect(host.textContent).toContain("残り 1時間");
    flushSync(() => vi.advanceTimersByTime(3600000));
    expect(host.textContent).toContain("残り 0時間");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(copy.expiredReceive);
  } finally {
    flushSync(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
