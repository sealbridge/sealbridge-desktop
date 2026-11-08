import { useStore } from "@/state/store";

export function DesktopNavigation({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  return <nav aria-label="Sealbridge" className="flex flex-wrap gap-2 p-3">
    <button className="ui-button" aria-current={state.activeView === "home" ? "page" : undefined} onClick={() => { dispatch({ type: "showHome" }); onClose(); }}>ホーム</button>
    <button className="ui-button" aria-current={state.activeView === "inbox" ? "page" : undefined} onClick={() => { dispatch({ type: "showInbox" }); onClose(); }}>受信箱</button>
  </nav>;
}
