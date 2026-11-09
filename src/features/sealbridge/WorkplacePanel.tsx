import { Select } from "../../components/Select";
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { appendComposerDraft } from "@/lib/drafts";
import type { WorkplaceDecision, WorkplaceSettings as Settings, WorkplaceStatus } from "../../../shared/sealbridge";
import { WorkplaceApproval } from "./WorkplaceApproval";
import { WorkplaceSettings } from "./WorkplaceSettings";

const openedInternal = new Set<string>();

export function WorkplacePanel({ agent }: { agent: string }) {
  const { state, dispatch } = useStore();
  const bridge = window.ogb?.sealbridge?.workplace;
  const [settings, setSettings] = useState<Settings>({ definitions: [], agents: {}, verified: {} });
  const [status, setStatus] = useState<WorkplaceStatus[]>([]);
  const [configure, setConfigure] = useState(false);
  const [card, setCard] = useState<WorkplaceDecision>();
  const [text, setText] = useState("");
  const [source, setSource] = useState<"owner-draft" | "owner-file">("owner-draft");
  const [level, setLevel] = useState<0 | 1>(0);
  const [noRecord, setNoRecord] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [internalOpen, setInternalOpen] = useState(() => openedInternal.has(agent));
  const selectedBot = state.bots?.find(bot => bot.id === state.selectedId);
  const internalTarget = selectedBot ? `bot:${selectedBot.id}:${selectedBot.threadId}` : undefined;
  useEffect(() => {
    let alive = true;
    void bridge?.settings().then(s => { if (alive) { setSettings(s); for (const d of s.definitions) void bridge.find(d.id).catch(() => {}); } }).catch(() => { if (alive) setMessage("作業場の設定を読めませんでした。"); });
    const poll = () => { void bridge?.status().then(s => { if (alive) setStatus(s); }).catch(() => {}); };
    poll(); const timer = setInterval(poll, 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(""); try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作できませんでした。"); } finally { setBusy(false); } };
  const prepare = (id: string, action: "launch" | "pass" | "stop" | "force") => { void run(async () => { if (bridge) setCard(await bridge.prepare({ action, agent, id, level, noRecord, ...(action === "pass" ? { text, source } : {}) })); }); };
  const decide = (accept: boolean) => {
    if (!card || busy) return;
    const decision = card;
    if (decision.executable === "internal") {
      setCard(undefined);
      if (accept && decision.id === internalTarget && internalOpen) {
        appendComposerDraft(decision.id, decision.text!);
        setText(""); dispatch({ type: "showChat" });
      }
      return;
    }
    // Electron requires the decision IPC to run during the owner's click activation.
    const result = bridge?.decide(decision.id, accept);
    setCard(undefined);
    void run(async () => { await result; if (accept && decision.action === "pass") setText(""); if (bridge) setStatus(await bridge.status()); });
  };
  const selected = settings.definitions.filter(d => settings.agents[agent]?.includes(d.id));
  return <section aria-label="自分のエージェントの作業場" className="space-y-4">
    <h3>作業場</h3>
    <p>起こす・渡す・止めるは別の操作です。受け取った依頼からの転送（段2・段3）はこの版では使えません。</p>
    <button className="ui-button" onClick={() => { openedInternal.add(agent); setInternalOpen(true); dispatch({ type: "showChat" }); }}>Desktop 内の作業場を開く</button>
    <p>Desktop 内の作業場は既存のチャットです。プロセスを起こさず、以前の会話も読めます。開くだけでは本文を渡しません。</p>
    <label className="block">自分の材料の種類<Select value={source} onChange={e => setSource(e.target.value as typeof source)}><option value="owner-draft">送る前の自分の下書き</option><option value="owner-file">自分で選んだ自分のファイルの場所</option></Select></label>
    <label className="block">渡す文の全文<textarea className="ui-input block w-full" value={text} onChange={e => setText(e.target.value)} /></label>
    <p>隔離中・検査できなかった・期限切れの依頼や、相手から受け取った中身をここに入れないでください。</p>
    <button className="ui-button" disabled={!internalOpen || !internalTarget || !text.trim() || busy || !bridge} onClick={() => { void run(async () => {
      if (!await bridge?.validateOwnerText(text)) throw new Error("秘密や招待トークンは渡せません。自分の材料を64 KB以内で入力してください。");
      setCard({ id: internalTarget!, action: "pass", name: "Desktop 内の作業場", executable: "internal", version: "Desktop", cwd: "Desktop", scope: "既存チャット", retention: "チャットの下書き・送信後の会話に残ります", level: 1, text, source });
    }); }}>Desktop 内の作業場へ渡す前に確認</button>
    <label className="block">起こす段<Select value={level} onChange={e => setLevel(e.target.value === "1" ? 1 : 0)}><option value="0">段0 · 起こすだけ</option><option value="1">段1 · 自分の材料だけ</option></Select></label>
    <label className="block"><input type="checkbox" checked={noRecord} onChange={e => setNoRecord(e.target.checked)} /> 確認した記録を残さない指定を使う</label>
    {selected.map(d => {
      const row = status.find(s => s.id === d.id), verified = settings.verified[d.id];
      const canPass = d.stdin === "text-eof" && !!verified?.scope && !!verified?.noRecord && !!verified?.stdin;
      return <div key={d.id} className="space-y-2 rounded border border-hairline p-3">
        <h4>{d.name}</h4><p>{row?.running ? "起きています" : "起きていません"}</p>
        <p>実行ファイル: {d.executable} · 版: {verified?.version ?? "未確認"}</p><p>ツールの範囲: {d.scopeDescription || "未確認"}</p>
        <button className="ui-button" disabled={busy || !!row?.running} onClick={() => prepare(d.id, "launch")}>{d.name} を起こす前に確認</button>
        {canPass && <button className="ui-button" disabled={busy || !row?.running || row.level !== 1 || row.delivered || !text.trim()} onClick={() => prepare(d.id, "pass")}>{d.name} へ渡す前に確認</button>}
        <button className="ui-button" disabled={busy || !row?.running} onClick={() => prepare(d.id, "stop")}>{d.name} を止める前に確認</button>
        {row?.notice.includes("一定時間") && <button className="ui-button" disabled={busy} onClick={() => prepare(d.id, "force")}>{d.name} の強制停止を確認</button>}
        {row && <><p role="status">{row.notice}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{row.output}</pre></>}
      </div>;
    })}
    <p>作業場の出力は画面にだけ表示します。Desktop はディスクに保存せず、相手へ自動送信しません。所有者が確認し、受信箱の回答欄へ手入力してください。</p>
    <p>この起動はローカル MCP 登録やホスト型アシスタント参加の代わりにはなりません。</p>
    <button className="ui-button" onClick={() => { setConfigure(open => !open); if (!configure && bridge) for (const d of settings.definitions) void bridge.find(d.id).catch(() => {}); }}>作業場の設定</button>
    {configure && bridge && <WorkplaceSettings bridge={bridge} settings={settings} agent={agent} onSettings={s => { setSettings(s); setCard(undefined); }} />}
    {card && <WorkplaceApproval card={card} busy={busy} onDecision={decide} />}
    {message && <p role="alert">{message}</p>}
  </section>;
}
