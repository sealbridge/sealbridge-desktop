import { useEffect, useState } from "react";
import type { ContextNarrowRequest, ContextReceiveStatus } from "../../../../shared/sealbridge";
import type { ContextGrantSummary } from "../../../../shared/context-pooling";
import { copy } from "../../../../shared/context-pooling-copy.json";
import { Select } from "../../../components/Select";
import { GrantSummary } from "./GrantSummary";

const lines = (value: string) => value.split("\n").map(item => item.trim()).filter(Boolean);

function narrower(parent: { selectors: string[]; fieldsAllowed: string[]; fieldsDenied: string[] },
  child: { selectors: string[]; fieldsAllowed: string[]; fieldsDenied: string[] }) {
  if (!child.selectors.length || child.selectors.some(item => !parent.selectors.includes(item))) return false;
  if (parent.fieldsAllowed.length && (!child.fieldsAllowed.length || child.fieldsAllowed.some(item => !parent.fieldsAllowed.includes(item)))) return false;
  if (parent.fieldsDenied.some(item => !child.fieldsDenied.includes(item))) return false;
  const fewerSelectors = child.selectors.length < parent.selectors.length;
  const fewerFields = parent.fieldsAllowed.length ? child.fieldsAllowed.length < parent.fieldsAllowed.length : child.fieldsAllowed.length > 0;
  return fewerSelectors || fewerFields;
}

function RedelegationForm({ request }: { request: NonNullable<ContextReceiveStatus["redelegation"]> }) {
  const [recipientId, setRecipientId] = useState("");
  const [selectors, setSelectors] = useState(request.parent.selectors.join("\n"));
  const [allowed, setAllowed] = useState(request.parent.fieldsAllowed.join("\n"));
  const [denied, setDenied] = useState(request.parent.fieldsDenied.join("\n"));
  const [angle, setAngle] = useState(request.parent.angle);
  const [body, setBody] = useState(request.parent.body ?? "");
  const [discloseRoot, setDiscloseRoot] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = { selectors: lines(selectors), fieldsAllowed: lines(allowed), fieldsDenied: lines(denied) };
  const ready = narrower(request.parent, draft) && angle.trim() && body.trim() && !!recipientId && new TextEncoder().encode(body).length <= 65536;
  const submit = () => {
    const bridge = window.ogb?.sealbridge;
    if (!bridge || !ready) return;
    const payload: ContextNarrowRequest = { id: request.id, recipientId, selectors: draft.selectors, fieldsAllowed: draft.fieldsAllowed,
      fieldsDenied: draft.fieldsDenied, angle: angle.trim(), body, discloseRoot };
    setBusy(true);
    void bridge.receiveNarrow(payload).finally(() => setBusy(false));
  };
  return <section aria-label="ほかの相手へ、狭めて頼む" className="space-y-2">
    <h4>{copy.redelegationTitle}</h4>
    <p>元の観点: {request.parent.angle}</p>
    <label>頼む先<Select value={recipientId} onChange={event => setRecipientId(event.target.value)}>
      <option value="">つながっている相手を選ぶ</option>
      {request.recipients.map(row => <option key={row.id} value={row.id}>{row.name} · {row.did}</option>)}
    </Select></label>
    <label className="block">範囲（selectors）<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={selectors} onChange={event => setSelectors(event.target.value)} /></label>
    <label className="block">許可する列<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={allowed} onChange={event => setAllowed(event.target.value)} /></label>
    <label className="block">拒否する列<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={denied} onChange={event => setDenied(event.target.value)} /></label>
    <label className="block">観点<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={angle} onChange={event => setAngle(event.target.value)} /></label>
    <label className="block">狭めた切り出し<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={body} onChange={event => setBody(event.target.value)} /></label>
    <p>{copy.redelegationDepth}</p>
    <p>{copy.redelegationVisibility}</p>
    <p>{copy.redelegationIdentity}</p>
    <label><input type="checkbox" checked={discloseRoot} onChange={event => setDiscloseRoot(event.target.checked)} /> {copy.redelegationDisclose}</label>
    <p>{copy.limitLong}</p>
    <button type="button" disabled={!ready || busy} onClick={submit}>この範囲で頼む</button>
  </section>;
}

function RedelegationCard({ card }: { card: NonNullable<ContextReceiveStatus["approvals"]>[number] }) {
  const bridge = window.ogb?.sealbridge;
  const decide = (accept: boolean) => { void bridge?.receiveDecide(card.id, accept); };
  return <section role="dialog" aria-label={card.gate === "final_verification" ? "納品の最終確認" : copy.redelegationTitle} className="space-y-2"
    onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}>
    <h4>{card.gate === "final_verification" ? "納品の最終確認" : copy.redelegationTitle}</h4>
    {card.angle && <p>元の観点: {card.angle}</p>}
    {card.recipient && <p>頼む先: {card.recipient}</p>}
    {card.gate === "redelegation" && <>
      <p>{copy.redelegationDiff}</p>
      <ul>{card.droppedSelectors?.map(item => <li key={`s-${item}`}>落ちた範囲: {item}</li>)}
        {card.droppedFields?.map(item => <li key={`f-${item}`}>落ちた列: {item}</li>)}
        {card.droppedLines?.map(item => <li key={`l-${item}`}>減った行: {item}</li>)}</ul>
      <p>{copy.redelegationDepth}</p>
      <p>{copy.redelegationVisibility}</p>
      <p>{copy.redelegationIdentity}</p>
      <p>{card.discloseRoot ? copy.redelegationDisclose : "既定では頼む先に伝えません"}</p>
      <p>{copy.limitLong}</p>
      {card.digest && <p>grant ダイジェスト <code>{card.digest}</code></p>}
    </>}
    {card.deliverable && <pre className="whitespace-pre-wrap">{card.deliverable}</pre>}
    {!!card.delegateeOwnerDids?.length && <p>2段目の相手 {card.delegateeOwnerDids.join("、")}</p>}
    <button type="button" onClick={() => decide(false)}>{copy.redelegationDeny}</button>
    <button type="button" onClick={() => decide(true)}>{card.gate === "final_verification" ? "最終確認を承認する" : copy.redelegationApprove}</button>
  </section>;
}

function Reply({ id, summary, sent }: { id: number; summary?: ContextGrantSummary; sent: () => void }) {
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const bytes = new TextEncoder().encode(body).length;
  return <section aria-label="手で答える" className="space-y-2">
    <label>答え<textarea className="ui-input block w-full" spellCheck={false} autoComplete="off" value={body}
      disabled={busy} onChange={event => { setBody(event.target.value); setConfirmed(false); }} /></label>
    <button type="button" disabled={!body.trim() || bytes > 65536 || busy} onClick={() => setConfirmed(true)}>答えを確認</button>
    {confirmed && <section aria-label="この答えを送ります" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}>
      <p>この答えを送ります</p>
      {summary && <GrantSummary summary={{ ...summary, bytes }} />}
      <p>答えの大きさ: {bytes} バイト</p><pre className="whitespace-pre-wrap">{body}</pre>
      <button type="button" disabled={busy} onClick={() => {
        const bridge = window.ogb?.sealbridge;
        if (!bridge) return;
        setBusy(true);
        void bridge.receiveReply(id, body).then(result => { if (result.ok) { setBody(""); sent(); } })
          .finally(() => setBusy(false));
      }}>この答えを送る</button>
      <button type="button" disabled={busy} onClick={() => setConfirmed(false)}>書き直す</button>
    </section>}
  </section>;
}

export function ContextReceivePanel() {
  const [status, setStatus] = useState<ContextReceiveStatus>({ state: "idle", rows: [], compose: [], rejected: [], approvals: [] });
  const bridge = window.ogb?.sealbridge;
  const [fetchFailed, setFetchFailed] = useState(false);
  useEffect(() => {
    if (!bridge?.receiveStatus) return;
    let active = true;
    const refresh = () => { void bridge.receiveStatus().then(value => { if (active) { setStatus(value); setFetchFailed(false); } }).catch(() => { if (active) setFetchFailed(true); }); };
    refresh();
    const timer = setInterval(refresh, 500);
    return () => { active = false; clearInterval(timer); };
  }, [bridge]);
  return <section aria-label="受信箱" className="space-y-3">
    <h3>受信箱</h3>
    <p>開くまでエージェントには渡りません</p>
    <p>この版は人が手で答えます。開いても AI には渡しません</p>
    {!bridge?.receiveStatus && <p>この版では受信箱の状態を表示できません。</p>}
    {(fetchFailed || status.state === "failed") && <p role="alert">受信箱を確認できませんでした</p>}
    {!fetchFailed && status.state === "ready" && status.rows.length === 0 && <p>開くのを待っている依頼はありません</p>}
    <p>相手が待っている間だけ開けます（既定10分）。過ぎたら送り直しが必要です。閉じると止まります。</p>
    {status.rows.map(row => <article key={row.id} className="space-y-2 rounded border p-3">
      <p>{row.sender}</p>
      <p>{row.state === "expired" ? "期限切れ" : row.inspectionStatus === "pending" ? "隔離中・検査中" :
        row.inspectionStatus === "complete" ? "判断待ち（検査完了）" :
          "検査できませんでした。この依頼は保留です。中身は読めますが、答えるには相手の送り直しが要ります"}</p>
      {row.inspection && <><p>ルール検査: {row.inspection.verdict}</p>
        {row.inspection.findings.map((finding, index) => <p key={index}>{finding.ruleId} · {finding.severity} · {finding.noteCode}</p>)}</>}
      {row.summary && <GrantSummary summary={row.summary} beforeOpen />}
      {row.preview !== undefined && <pre className="whitespace-pre-wrap" aria-label="本文プレビュー">{row.preview}</pre>}
      <button type="button" disabled={!row.canOpen || row.inspectionStatus !== "complete" || row.state !== "reviewable"}
        onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
        onClick={() => { void bridge?.receiveAction(row.id, "open"); }}>開く</button>
      <button type="button" onClick={() => { void bridge?.receiveAction(row.id, "discard"); }}>捨てる</button>
    </article>)}
    {status.redelegation && <RedelegationForm key={status.redelegation.id} request={status.redelegation} />}
    {status.approvals?.map(card => <RedelegationCard key={card.id} card={card} />)}
    {status.compose.map(item => <Reply key={item.id} {...item} sent={() => setStatus(value => ({ ...value, compose: value.compose.filter(row => row.id !== item.id) }))} />)}
    {status.rejected.map((item, index) => <p key={index} role="status">依頼は断られました: {item.code}</p>)}
  </section>;
}
