// The splash can be destroyed mid-boot: during startup an empty window set means boot is still working, not quit.
// `stayOpen()`: the app started at login out of sight, so it runs with no window until the person opens one.
export function createAllWindowsClosedQuit({ app, platform = process.platform, allWindows, stayOpen = () => false }) {
  let startupSettled = false;
  const maybeQuit = () => {
    if (platform === "darwin" || !startupSettled || stayOpen()) return;
    if (allWindows().length > 0) return;
    app.quit();
  };
  app.on("window-all-closed", maybeQuit);
  return {
    // window-all-closed does not repeat for an already-empty set, so the drained check runs here too.
    settleStartup: () => {
      startupSettled = true;
      maybeQuit();
    },
  };
}
// Linux package managers and watchdogs stop apps with SIGTERM/SIGINT: the first becomes a normal quit,
// a second keeps Node's default force-quit (`once` listeners).
export function registerSignalQuit({ app, process }) {
  let signalQuitRequested = false;
  const requestSignalQuit = () => {
    if (signalQuitRequested) return;
    signalQuitRequested = true;
    app.quit();
  };
  process.once("SIGINT", requestSignalQuit);
  process.once("SIGTERM", requestSignalQuit);
}
