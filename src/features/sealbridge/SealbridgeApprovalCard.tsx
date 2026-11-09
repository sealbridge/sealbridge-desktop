import type { ReactNode } from "react";

export function SealbridgeApprovalCard({ title, label, children, accept, cancel, busy, onDecision }: {
  title: string; label?: string; children: ReactNode; accept: string; cancel: string; busy?: boolean; onDecision(accept: boolean): void;
}) {
  return <div role="dialog" aria-modal="true" aria-label={label ?? title} className="space-y-3 rounded-lg border border-hairline bg-card p-4 text-ink"
    onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape" && !busy) onDecision(false); }}>
    <h3 className="font-semibold">{title}</h3>
    {children}
    <div className="flex gap-3">
      <button autoFocus type="button" className="ui-button" disabled={busy} onClick={() => onDecision(false)}>{cancel}</button>
      <button type="button" className="ui-button" disabled={busy} onClick={() => onDecision(true)}>{accept}</button>
    </div>
  </div>;
}
