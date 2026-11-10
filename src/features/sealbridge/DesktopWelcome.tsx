import { useState } from "react";
import { api, useStore } from "@/state/store";
import { completionPatch, markWelcomeFinished } from "@/lib/onboarding";
import { setEmailGateDone } from "@/lib/analytics";
import { clearWelcomeDraft } from "@/lib/welcome-draft";
import { InvitePasteButton } from "./InvitePasteButton";
import { useIdentity } from "./useIdentity";
import { PRODUCT_NAME } from "@/lib/brand";

export function DesktopWelcome({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore();
  const identity = useIdentity();
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ready = identity?.state === "ready" && Boolean(identity.did);
  const finish = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const config = await api("/api/config", { method: "PUT", body: JSON.stringify(completionPatch()), signal: AbortSignal.timeout(10_000) });
      dispatch({ type: "configStatus", config });
      setEmailGateDone("submitted");
      markWelcomeFinished();
      clearWelcomeDraft();
      dispatch({ type: "showHome" });
      onDone();
    } catch { setError("初回案内を完了できませんでした。再試行してください。"); }
    finally { setSaving(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label="届け先の準備" className="fixed inset-0 z-50 overflow-y-auto bg-app p-8 text-ink">
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-xl">{PRODUCT_NAME}</h1>
      <h2>あなたのエージェントの届け先を準備します。</h2>
      <p>届け先は、この端末で依頼を受け取るための公開アドレスです。鍵はOSの鍵保管庫に保存します。ホストされた作業環境への登録ではありません。</p>
      <p>準備ができたらホームへ進みます。チャットは「自分のエージェント」→「届け先の詳細」→「作業場」からアプリ内のチャットを開きます。外部の作業場を用意する必要はありません。</p>
      {!started ? <button className="ui-button" onClick={() => setStarted(true)}>届け先を準備する</button> : <>
        <p role="status">{ready ? "届け先の準備ができました。届いた依頼は受信箱で確認します。" : identity?.state === "key-store-unavailable" ? "OSの鍵保管庫を利用できません。鍵保管庫を有効化・解錠してください。" : identity?.state === "failed" ? "識別情報を準備できませんでした。" : "あなたの識別情報を準備しています…"}</p>
        <dl className="space-y-2 break-all"><dt>名前</dt><dd>未確認</dd>
          <dt>公開アドレス</dt><dd>{ready ? identity?.did : "未確認"}</dd>
          <dt>鍵の状態</dt><dd>{ready ? "OSの鍵保管庫で準備済み" : "未確認"}</dd></dl>
        <button className="ui-button" disabled={!ready || saving} onClick={() => { void finish(); }}>ホームを見る</button>
        {(identity?.state === "failed" || identity?.state === "key-store-unavailable") && <button className="ui-button" onClick={() => { void window.ogb?.sealbridge?.retry().catch(() => setError("再試行できませんでした。")); }}>再試行</button>}
        <InvitePasteButton />
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
