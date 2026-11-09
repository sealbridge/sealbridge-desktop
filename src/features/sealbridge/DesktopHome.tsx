import { useState } from "react";
import { useStore } from "@/state/store";
import { ContextPoolingView } from "./context-pooling/ContextPoolingView";
import { useIdentity } from "./useIdentity";
import { WorkplacePanel } from "./WorkplacePanel";

export function DesktopHome({ inbox }: { inbox: boolean }) {
  const { dispatch } = useStore();
  const identity = useIdentity();
  const [detail, setDetail] = useState(false);
  const did = identity?.state === "ready" ? identity.did : null;
  const openInbox = () => dispatch({ type: "showInbox" });
  return <main className="min-w-0 flex-1 overflow-y-auto p-6 text-ink">
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold">{inbox ? "受信箱" : "ホーム"}</h1>
      {!inbox && <>
        <section className="space-y-3"><h2>開くのを待っている依頼</h2>
          <p>開くまでエージェントには渡りません</p>
          <button className="ui-button" onClick={openInbox}>受信箱で確認する</button>
        </section>
        <section className="space-y-3"><h2>進行中の仕事</h2>
          <p>持ち寄りの送受信状況を確認します。</p><button className="ui-button" onClick={openInbox}>仕事を確認する</button>
        </section>
        <section className="space-y-3"><h2>自分のエージェント</h2>
          <button className="ui-button" onClick={() => setDetail(!detail)}>すべて見る</button>
          <p>{did ? "この端末のエージェント" : "未確認"}</p>
          <button className="ui-button" onClick={() => setDetail(!detail)}>届け先の詳細</button>
          <p className="break-all">{did ? detail ? did : `${did.slice(0, 18)}…${did.slice(-6)}` : "未確認"}</p>
          {detail && <><p>名前: 未確認</p><p>鍵の状態: {did ? "OSの鍵保管庫で準備済み" : "未確認"}</p>{did && <WorkplacePanel agent={did} />}</>}
        </section>
        <section className="space-y-3"><h2>つながり</h2>
          <p>この版では署名を確認したつながりの総数・一覧とチャンネルの状態を表示できません。</p>
          <details><summary className="cursor-pointer">つながり・チャンネルの状態</summary>
            <p>この版には、つながり一覧とチャンネル詳細を表示する画面がありません。</p>
          </details>
        </section>
      </>}
      <div hidden={!inbox}><ContextPoolingView /></div>
    </div>
  </main>;
}
