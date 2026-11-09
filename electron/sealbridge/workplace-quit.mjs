export function createWorkplaceQuit({ workplaces, dialog, quit }) {
  let approved = false, pending = false;
  return event => {
    const current = workplaces();
    if (approved || !current?.status().some(row => row.running)) return false;
    event.preventDefault();
    if (pending) return true;
    pending = true;
    void (async () => {
      const names = current.status().filter(row => row.running).map(row => row.name).join("、");
      const choice = await dialog.showMessageBox({ type: "question", title: "動いている作業場", message: `${names} を止めて閉じますか。`,
        detail: "止めても、作業場が保存した履歴やファイルは消えません。止めたことは削除の証明にはなりません。",
        buttons: ["止める", "残す"], defaultId: 1, cancelId: 1 });
      if (choice.response === 0 && !await current.stopAll()) {
        const force = await dialog.showMessageBox({ type: "warning", title: "作業場が終わりません", message: "一定時間で終わりませんでした。強制停止しますか。",
          detail: "途中の結果は残っていないかもしれません。履歴やファイルは消えません。", buttons: ["強制停止", "続ける"], defaultId: 1, cancelId: 1 });
        if (force.response !== 0 || !await current.stopAll(true)) return;
      }
      approved = true;
      quit();
    })().catch(() => {}).finally(() => { pending = false; });
    return true;
  };
}
