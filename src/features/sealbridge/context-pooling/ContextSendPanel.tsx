import { useEffect, useState } from "react";
import type { ContextSelectionDraft } from "../../../../shared/context-pooling";
import type { ContextRecipient, ContextSendStatus } from "../../../../shared/sealbridge";
import { Select } from "../../../components/Select";

export function ContextSendPanel({ draft, ready }: { draft: ContextSelectionDraft; ready: boolean }) {
  const bridge = window.ogb?.sealbridge;
  const [recipients, setRecipients] = useState<ContextRecipient[]>([]);
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<ContextSendStatus>({ state: "idle" });
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void bridge?.contextRecipients?.().then(rows => { if (alive) setRecipients(rows); }).catch(() => {});
    const poll = () => { void bridge?.contextStatus?.().then(value => { if (alive) setStatus(value); }).catch(() => {}); };
    poll();
    const timer = setInterval(poll, 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);
  const card = status.approval;
  const terminal = ["completed", "failed", "cancelled", "pending", "timed-out"].includes(status.state);
  const start = async () => {
    if (!bridge) return;
    try {
      if (terminal) await bridge.resetContext();
      const result = await bridge.startContext(target, draft);
      if (result.ok) { setStatus({ state: "starting" }); setError(""); }
      else setError("送信を開始できませんでした。宛先と下書きを確認してください。");
    } catch { setError("送信を開始できませんでした。"); }
  };
  return <section aria-label="持ち寄りの送信" className="space-y-3">
    <label>宛先<Select value={target} onChange={event => setTarget(event.target.value)}>
      <option value="">つながっている相手を選ぶ</option>
      {recipients.map(row => <option key={row.id} value={row.id}>{row.name} · {row.did} · 接続済み</option>)}
    </Select></label>
    <button type="button" className="ui-button" disabled={!ready || !target || (!terminal && status.state !== "idle")} onClick={() => { void start(); }}>送る</button>
    <p role="status">{({ idle: "下書きの確認は承認ではありません。", starting: "送信を準備しています", approval: "所有者の確認を待っています", sending: "送信中", working: "相手が作業中", waiting: "確認中", completed: "納品の最終確認が完了しました", failed: "送信を完了できませんでした。送り直す場合は下書きから作り直します。", cancelled: "中止しました", pending: "相手の側で保留になりました。送り直す場合は下書きから作り直してください。", "timed-out": "待ち時間が過ぎました。相手の保留を開くには送り直しが必要です。" } as Record<string, string>)[status.state]}</p>
    {status.deliverable && <pre className="whitespace-pre-wrap">{status.deliverable}</pre>}
    {!!status.delegateeOwnerDids?.length && <p>2段目の相手 {status.delegateeOwnerDids.join("、")}</p>}
    {status.peerRejected && <p role="alert">相手の版が持ち寄りに対応していない可能性があります</p>}
    {card && <div role="dialog" aria-label="持ち寄りの承認" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}>
      <p>{card.gate === "final_verification" ? "納品の最終確認" : "この内容で送りますか"}</p>
      <p>宛先 {card.recipient} · {card.mode} · 観点 {card.angle}</p>
      <p>許可する列 {card.allowedCount} · 拒否する列 {card.deniedCount} · {card.bytes} バイト · 期限 {card.expiresAt}</p>
      <p>grant ダイジェスト <code>{card.digest}</code></p>
      {card.deliverable && <pre className="whitespace-pre-wrap">{card.deliverable}</pre>}
      {card.deliverableDigest && <p>納品物ダイジェスト <code>{card.deliverableDigest}</code></p>}
      {!!card.delegateeOwnerDids?.length && <p>2段目の相手 {card.delegateeOwnerDids.join("、")}</p>}
      <button type="button" className="ui-button" onClick={() => { void bridge?.answerContext(card.id, false); }}>拒否する</button>
      <button type="button" className="ui-button" onClick={() => { void bridge?.answerContext(card.id, true); }}>{card.gate === "final_verification" ? "最終確認を承認する" : "この内容で送る"}</button>
    </div>}
    {!terminal && status.state !== "idle" && <button type="button" className="ui-button" onClick={() => { void bridge?.cancelContext(); }}>中止</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
