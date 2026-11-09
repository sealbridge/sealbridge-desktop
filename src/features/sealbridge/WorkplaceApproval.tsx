import type { WorkplaceDecision } from "../../../shared/sealbridge";
import { SealbridgeApprovalCard } from "./SealbridgeApprovalCard";

export function WorkplaceApproval({ card, busy, onDecision }: { card: WorkplaceDecision; busy?: boolean; onDecision(accept: boolean): void }) {
  const launch = card.action === "launch", pass = card.action === "pass";
  return <SealbridgeApprovalCard title={launch ? "作業場を起こす確認" : pass ? "作業場へ渡す確認" : "作業場を止める確認"}
    accept={launch ? "起こす" : pass ? "渡す" : card.action === "force" ? "強制停止" : "止める"}
    cancel={launch ? "やめる" : pass ? "渡さない" : "続ける"} busy={busy} onDecision={onDecision}>
    <p>作業場: {card.name}</p>
    {launch ? <>
      <p>実行ファイル: {card.executable}</p><p>版: {card.version}</p><p>作業フォルダ: {card.cwd}</p>
      <p>ツールの範囲: {card.scope}</p><p>記録: {card.retention}</p><p>依頼の本文はまだ渡しません</p>
    </> : pass ? <>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{card.text}</pre>
      <p>段{card.level} · 元: {card.source === "owner-file" ? "所有者が選んだ自分のファイルの場所" : "所有者自身の下書き"}。受け取った依頼・仕事は元にしません。</p>
      <p>送り方: {card.executable === "internal" ? "Desktop 内のチャットの下書き欄" : "標準入力のみ"}。内容を残すことを認める場合だけ「渡す」を選んでください。</p>
      <p>記録: {card.retention}</p><p>作業場の向こうのモデル提供者に内容が届きます。</p>
    </> : <>
      <p>走っている処理: {card.executable} · 段{card.level}</p>
      {card.action === "force" && <p>一定時間で終わりませんでした。強制停止します。途中の結果は残っていないかもしれません。</p>}
      <p>止めても、作業場が保存した履歴やファイルは消えません。止めたことは削除の証明にはなりません</p>
    </>}
  </SealbridgeApprovalCard>;
}
