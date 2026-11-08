import { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { initialState, reducer, StoreContext } from "../../src/state/store";
import { DesktopHome } from "../../src/features/sealbridge/DesktopHome";
import { DesktopWelcome } from "../../src/features/sealbridge/DesktopWelcome";
import "../../src/styles.css";

let receiveFailure = false;
let keyFailure = false;
Object.assign(window, {
  fixtureReceiveFailure: () => { receiveFailure = true; },
  fixtureKeyFailure: () => { keyFailure = true; },
  ogb: { sealbridge: {
    status: async () => ({ state: keyFailure ? "key-store-unavailable" : "ready", did: keyFailure ? null : "did:key:fixture-public-address" }),
    receiveStatus: async () => {
      if (receiveFailure) throw new Error("fixture");
      return { state: "ready", rows: [], compose: [], rejected: [], approvals: [] };
    },
    receivedAudits: async () => [],
    contextRecipients: async () => [],
  } },
});

function Fixture() {
  const [state, dispatch] = useReducer(reducer, { ...initialState, config: { profile: { name: "Fixture" } } } as typeof initialState);
  const [welcome, setWelcome] = useState(true);
  return <StoreContext.Provider value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    {welcome ? <DesktopWelcome onDone={() => setWelcome(false)} /> : <DesktopHome inbox={state.activeView === "inbox"} />}
  </StoreContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
