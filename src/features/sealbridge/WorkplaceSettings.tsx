import { Select } from "../../components/Select";
import { useState } from "react";
import type { WorkplaceBridge, WorkplaceDefinition, WorkplaceSettings as Settings } from "../../../shared/sealbridge";
import { emptyWorkplace, workplaceExamples } from "./workplace-presets";
import { SealbridgeApprovalCard } from "./SealbridgeApprovalCard";

const fields = [["name", "表示名"], ["executable", "実行ファイル"], ["cwd", "作業フォルダ"]] as const;
const argumentFields = [["versionArgs", "版の確認"], ["scopeArgs", "範囲の置き換え"], ["noRecordArgs", "記録を残さない指定"]] as const;
const checkFields = [["scope", "範囲の置き換え"], ["noRecord", "記録を残さない指定"], ["stdin", "標準入力"], ["stop", "停止方法"]] as const;
export function WorkplaceSettings({ bridge, settings, agent, onSettings }: { bridge: WorkplaceBridge; settings: Settings; agent: string; onSettings(s: Settings): void }) {
  const [draft, setDraft] = useState<WorkplaceDefinition>();
  const [testing, setTesting] = useState<string>();
  const [checks, setChecks] = useState<Record<string, { scope: boolean; noRecord: boolean; stdin: boolean; stop: boolean }>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(""); try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "設定を確認できませんでした。"); } finally { setBusy(false); } };
  const update = (patch: Partial<WorkplaceDefinition>) => setDraft(d => d ? { ...d, ...patch } : d);
  return <section className="space-y-4" aria-label="作業場の設定">
    <h3>作業場の設定</h3>
    <p>定義はアプリで共通です。使う作業場は、この自分のエージェントの詳細で選びます。選択だけでは本文・鍵・履歴を共有しません。</p>
    <div className="flex gap-3">
      <details><summary>例から入力する</summary>{workplaceExamples.map(example => <button key={example.label} className="ui-button" onClick={() => { setDraft({ ...emptyWorkplace(), ...example.values }); setMessage(""); }}>{example.label}</button>)}</details>
      <button className="ui-button" onClick={() => { setDraft(emptyWorkplace()); setMessage(""); }}>自分で紐付ける</button>
    </div>
    <p>秘密・ログイン・API キーは入力しないでください。実行ファイルと引数を分け、引数は1行に1件で入力します。シェルの命令文ではありません。</p>
    {draft && <fieldset disabled={busy} className="space-y-3"><legend>紐付け</legend>
      {fields.map(([key, label]) => <label key={key} className="block">{label}<input className="ui-input block w-full" value={draft[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}
      <label className="block">引数（1行に1件）<textarea className="ui-input block w-full" value={draft.args.join("\n")} onChange={e => update({ args: e.target.value ? e.target.value.split("\n") : [] })} /></label>
      <details><summary>詳細欄</summary><div className="space-y-3">
        {argumentFields.map(([key, label]) => <label key={key} className="block">{label}（引数、1行に1件）<textarea className="ui-input block w-full" value={draft[key].join("\n")} onChange={e => update({ [key]: e.target.value ? e.target.value.split("\n") : [] })} /></label>)}
        <label className="block">ツールの範囲の説明<textarea className="ui-input block w-full" value={draft.scopeDescription} onChange={e => update({ scopeDescription: e.target.value })} /></label>
        <label className="block">標準入力<Select value={draft.stdin} onChange={e => update({ stdin: e.target.value as WorkplaceDefinition["stdin"] })}><option value="none">渡さない（段0だけ）</option><option value="text-eof">全文を渡して入力を閉じる</option></Select></label>
        <label className="block">停止方法<Select value={draft.stop} onChange={e => update({ stop: e.target.value as WorkplaceDefinition["stop"] })}><option value="terminate">プロセス終了（結果の保持は未確認）</option><option value="interrupt-terminate">SIGINT、その後 SIGTERM</option></Select></label>
        <label className="block">記録<Select value={draft.retention} onChange={e => update({ retention: e.target.value as WorkplaceDefinition["retention"] })}><option value="unknown">未確認</option><option value="retained">記録が残る</option></Select></label>
      </div></details>
      <button className="ui-button" onClick={() => { void run(async () => { onSettings(await bridge.save(draft)); setDraft(undefined); setMessage("保存しました。起動・版の実行・受け渡しはしていません。"); }); }}>紐付けを保存</button>
    </fieldset>}
    {settings.definitions.map(d => {
      const verified = settings.verified[d.id];
      const confirmed = checks[d.id] ?? { scope: false, noRecord: false, stdin: false, stop: false };
      return <div key={d.id} className="space-y-2 rounded border border-hairline p-3">
        <label><input type="checkbox" disabled={busy} checked={settings.agents[agent]?.includes(d.id) ?? false} onChange={e => { const ids = settings.agents[agent] ?? []; void run(async () => onSettings(await bridge.select(agent, e.target.checked ? [...ids, d.id] : ids.filter(id => id !== d.id)))); }} /> この自分のエージェントで {d.name} を使う</label>
        <p>実行ファイル: {d.executable} · 版: {verified ? `確認できた (${verified.version})` : "未確認"}</p>
        <p>表示名・引数・作業フォルダ: 設定値（動作は未確認）。実行ファイル: {verified ? "版の実行を確認できた" : "未確認"}</p>
        {checkFields.map(([key, label]) => <p key={key}>{label}: {verified?.[key] ? "確認できた" : "未確認"}</p>)}
        <p>範囲の置き換えと記録を残さない指定を確かめるまでは段0（起こすだけ）を推奨します。</p>
        <button className="ui-button" disabled={busy} onClick={() => setDraft(structuredClone(d))}>編集</button>
        <button className="ui-button" disabled={busy} onClick={() => { void run(async () => setMessage(await bridge.find(d.id) ?? "実行ファイルを見つけられませんでした。")); }}>実行ファイルを探す</button>
        <button className="ui-button" disabled={busy} onClick={() => setTesting(d.id)}>所有者が確認して試す（版を読む）</button>
        {verified && <details><summary>実機で確かめた項目を記録する</summary>
          <p>設定や製品名だけで確認済みにしないでください。手元のハーネスで確かめた項目だけを選んでください。</p>
          {checkFields.map(([key, label]) => <label key={key} className="block"><input type="checkbox" checked={confirmed[key]} onChange={e => setChecks(c => ({ ...c, [d.id]: { ...confirmed, [key]: e.target.checked } }))} />{label}</label>)}
          <button className="ui-button" disabled={busy} onClick={() => { void run(async () => onSettings(await bridge.verify(d.id, confirmed))); }}>確認した結果を保存</button>
        </details>}
      </div>;
    })}
    {testing && <SealbridgeApprovalCard title="版を読むプログラムの実行" accept="確認して試す" cancel="やめる" busy={busy} onDecision={accept => {
      const id = testing; setTesting(undefined); if (accept) { const result = bridge.test(id); void run(async () => onSettings(await result)); }
    }}><p>{settings.definitions.find(d => d.id === testing)?.name} の実行ファイルと版の確認用引数を使ってプログラムを動かします。本文は渡しません。</p>
      <pre>{settings.definitions.find(d => d.id === testing)?.executable}{"\n"}{JSON.stringify(settings.definitions.find(d => d.id === testing)?.versionArgs)}{"\n"}{settings.definitions.find(d => d.id === testing)?.cwd}</pre>
    </SealbridgeApprovalCard>}
    {message && <p role="status">{message}</p>}
  </section>;
}
