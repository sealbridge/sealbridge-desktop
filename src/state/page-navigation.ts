import type { Action, AppState } from "./store";

type PageAction = Extract<Action, { type: "showHome" | "showInbox" | "showChat" | "showTeamMap" | "showFiles" | "showWebPanel" }>;

export function navigatePage(state: AppState, action: PageAction): AppState {
  switch (action.type) {
    case "showHome":
    case "showInbox":
      return { ...state, activeView: action.type === "showHome" ? "home" : "inbox", settingsOpen: false, appSettingsOpen: false, pluginsOpen: false };
    case "showChat":
      return state.activeView === "chat" ? state : { ...state, activeView: "chat" };
    case "showTeamMap":
    case "showFiles": case "showWebPanel":
      return {
        ...state,
        activeView: action.type === "showFiles" ? "files" : action.type === "showWebPanel" ? "web-panel" : "team-map",
        filesSuggest: action.type === "showFiles" && action.suggest?.length ? action.suggest : null, webPanelId: action.type === "showWebPanel" ? action.id : state.webPanelId,
        settingsOpen: false, computerOpen: false, inspectorOpen: false, activityOpen: false, appSettingsOpen: false, pluginsOpen: false,
      };
  }
}
