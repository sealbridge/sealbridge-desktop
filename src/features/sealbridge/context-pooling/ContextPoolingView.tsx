import { ContextReceivePanel } from "./ContextReceivePanel";
import { ContextReceivedPanel } from "./ContextReceivedPanel";
import { ContextSendPanel } from "./ContextSendPanel";
import { useRef, useState } from "react";
import { defaultContextDraft, selectionBytes, selectionError } from "../../../../shared/context-pooling";
import type { ContextGrantSummary, ContextSelectionDraft } from "../../../../shared/context-pooling";
import { copy, modes } from "../../../../shared/context-pooling-copy.json";
import { Select } from "../../../components/Select";
import { GrantSummary } from "./GrantSummary";

const templates = ["工程の可否と、足りない情報の箇条書きだけ", "材料費と工程費の内訳見積もり", "違反の有無と該当箇所"];
const splitLines = (value: string) => value.split("\n").map(item => item.trim()).filter(Boolean);

export function ContextPoolingView() {
  const [draft, setDraft] = useState(defaultContextDraft);
  const [summary, setSummary] = useState<ContextGrantSummary>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const bridge = window.ogb?.sealbridge;
  const update = (patch: Partial<ContextSelectionDraft>) => {
    generation.current++;
    setDraft(previous => ({ ...previous, ...patch })); setSummary(undefined); setMessage("");
  };
  const error = selectionError(draft), bytes = selectionBytes(draft.body);
  const prepare = async () => {
    if (error || busy || !bridge?.prepareContext) return;
    const current = generation.current;
    setBusy(true);
    try {
      const result = await bridge.prepareContext(draft);
      if (current !== generation.current) return;
      if (result.ok) setSummary(result.summary);
      else setMessage(result.message);
    } catch { if (current === generation.current) setMessage("切り出しを確認できませんでした。再試行してください。"); }
    finally { setBusy(false); }
  };
  return <details open className="mt-3 text-ink">
    <summary className="cursor-pointer">持ち寄り</summary>
    <section aria-label="持ち寄りの準備" className="space-y-4 py-4">
      <p>{copy.limit}</p>
      <p>送る部分を自分で切り出して入力してください。範囲の宣言だけでは本文の列や行は取り除かれません。</p>
      {([['selectors', '範囲（selectors）'], ['fieldsAllowed', '許可する列（fieldsAllowed）'], ['fieldsDenied', '拒否する列（fieldsDenied）']] as const).map(([key, label]) =>
        <label key={key} className="block">{label}（1行に1件）<textarea className="ui-input block w-full" value={draft[key].join("\n")}
          onChange={event => update({ [key]: event.target.value.split("\n") })} onBlur={() => {
            const normalized = splitLines(draft[key].join("\n"));
            if (normalized.length !== draft[key].length || normalized.some((value, index) => value !== draft[key][index])) update({ [key]: normalized });
          }} /></label>)}
      <label className="block">観点テンプレ<Select className="w-full" value={templates.includes(draft.angle) ? draft.angle : ""} onChange={event => update({ angle: event.target.value })}>
        <option value="">自由入力</option>{templates.map(value => <option key={value}>{value}</option>)}
      </Select></label>
      <label className="block">観点<textarea className="ui-input block w-full" maxLength={2048} placeholder={copy.anglePlaceholder} value={draft.angle} onChange={event => update({ angle: event.target.value })} /></label>
      <label className="block">送信する切り出し本文<textarea className="ui-input block w-full" rows={6} spellCheck={false} autoComplete="off" value={draft.body} onChange={event => update({ body: event.target.value })} /></label>
      <p>切り出しの大きさ: {(bytes / 1024).toFixed(2)} KB / 上限 64 KB</p>
      <p>送信時の JSON 表現を UTF-8 で数えます。</p>
      <fieldset className="space-y-3"><legend>送り方</legend><p>{copy.lead}</p>
        {(Object.keys(modes) as (keyof typeof modes)[]).map(mode => <label key={mode} className="block">
          <input type="radio" name="context-delivery" value={mode} checked={draft.deliveryMode === mode}
            onChange={() => update({ deliveryMode: mode })} /> {modes[mode].label}
          <span className="block">{modes[mode].description}</span>
        </label>)}
      </fieldset>
      {draft.deliveryMode === "view_only" && <p>閲覧のみでも、受け手の監査ファイルには答えの中身が残ります。</p>}
      {draft.deliveryMode === "approval_redelegation" && <p>{copy.approvalExtra}</p>}
      {draft.deliveryMode === "hand_over" && <p>{copy.handOverExtra}</p>}
      <p>{modes[draft.deliveryMode].retention}</p>
      <label className="block">有効期限（時間）<input className="ui-input" type="number" min={1} max={168} value={draft.lifetimeHours}
        onChange={event => update({ lifetimeHours: event.target.valueAsNumber })} /></label>
      <p>{copy.expiryDefault}</p>
      <p>{copy.beforeSend}</p>
      {error && <p role="alert">{error}</p>}
      <button className="ui-button" disabled={!!error || busy || !bridge?.prepareContext} onClick={() => { void prepare(); }}>送る前に確認</button>
      <ContextSendPanel draft={draft} ready={!!summary && !error && !busy} />
      <p>下書きはメモリだけに置きます。</p>
      {message && <p role="status">{message}</p>}
      {summary && <GrantSummary summary={summary} />}
    </section>
    <ContextReceivePanel />
    <ContextReceivedPanel />
  </details>;
}
