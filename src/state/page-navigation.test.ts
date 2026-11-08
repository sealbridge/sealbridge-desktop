import { expect, it } from "vitest";
import { initialState, reducer } from "./store";

it("launches at home and keeps conversation state when opening the inbox", () => {
  expect(initialState.activeView).toBe("home");
  const state = { ...initialState, activeView: "chat" as const, selectedId: "existing", settingsOpen: true, appSettingsOpen: true };
  const inbox = reducer(state, { type: "showInbox" });
  expect(inbox).toMatchObject({ activeView: "inbox", selectedId: "existing", settingsOpen: false, appSettingsOpen: false });
  expect(inbox.bots).toBe(state.bots);
  expect(inbox.groups).toBe(state.groups);
  expect(reducer(inbox, { type: "showHome" }).activeView).toBe("home");
});
