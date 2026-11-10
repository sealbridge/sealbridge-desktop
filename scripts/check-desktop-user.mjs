import { pathToFileURL } from "node:url";

export function desktopUserError({ platform = process.platform, uid = process.getuid?.(), env = process.env } = {}) {
  if (platform !== "linux" || uid !== 0 || env.ELECTRON_DISABLE_SANDBOX === "1") return null;
  return "Electron cannot run as root with its sandbox. Run as a regular user. For an isolated disposable container only, explicitly use ELECTRON_DISABLE_SANDBOX=1 pnpm dev:desktop (disables the Chromium sandbox).";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const error = desktopUserError();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
