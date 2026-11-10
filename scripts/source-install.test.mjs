import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { desktopUserError } from "./check-desktop-user.mjs";

it("requires explicit sandbox opt-out for Linux root only", () => {
  expect(desktopUserError({ platform: "linux", uid: 0, env: {} })).toContain("ELECTRON_DISABLE_SANDBOX=1");
  expect(desktopUserError({ platform: "linux", uid: 0, env: { ELECTRON_DISABLE_SANDBOX: "0" } })).not.toBeNull();
  expect(desktopUserError({ platform: "linux", uid: 0, env: { ELECTRON_DISABLE_SANDBOX: "1" } })).toBeNull();
  expect(desktopUserError({ platform: "linux", uid: 1000, env: {} })).toBeNull();
  expect(desktopUserError({ platform: "win32", env: {} })).toBeNull();
});

it("keeps dependency installation free of git configuration mutations", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(scripts.prepare).toBeUndefined();
  expect(scripts["hooks:install"]).toBe("node scripts/install-git-hooks.mjs");
  for (const name of ["build", "typecheck"]) {
    expect(scripts[name]).toContain("node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b");
    expect(scripts[name]).toContain("node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.server.json");
  }
});
