import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { resolveRuntime } from "../electron/sealbridge/runtime.mjs";
import { product } from "../electron/sealbridge/product.mjs";
import afterPack from "./after-pack.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { getFileMatchers, copyFiles } = builderRequire("app-builder-lib/out/fileMatcher.js");

it.each(["win32", "darwin", "linux"])("copies the CLI package and bin with electron-builder on %s", async platform => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sealbridge-package-"));
  try {
    const source = path.join(root, "build", "sealbridge-runtime-x64");
    const packageDir = path.join(source, "node_modules", product.cliPackage);
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, "package.json"), JSON.stringify({
      name: product.cliPackage, version: product.cliVersion,
      bin: { [product.cliPackage]: "cli.js" },
    }));
    await writeFile(path.join(packageDir, "cli.js"), "");
    await writeFile(path.join(source, "bootstrap.mjs"), "");
    const config = parse(await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"));
    config.extraResources = config.extraResources.filter(entry => entry.to.startsWith("sealbridge-runtime"));
    const resources = path.join(root, "resources");
    const matchers = getFileMatchers(config, "extraResources", resources, {
      defaultSrc: root, globalOutDir: path.join(root, "release"), customBuildOptions: {},
      macroExpander: value => value.replaceAll("${arch}", "x64"),
    });
    await copyFiles(matchers.filter(matcher => matcher.from === source));
    expect(() => resolveRuntime({ resourcesPath: resources })).toThrow(/package\.json/);
    await copyFiles(matchers);
    const { cliEntry } = resolveRuntime({ resourcesPath: resources });
    expect(await readFile(path.join(resources, "sealbridge-runtime", "bootstrap.mjs"), "utf8")).toBe("");
    await rm(cliEntry);
    await expect(afterPack({
      electronPlatformName: platform, appOutDir: root,
      packager: { getResourcesDir: () => resources },
    })).rejects.toThrow("SEALBRIDGE_RUNTIME_INVALID");
    await rm(path.join(resources, "sealbridge-runtime", "node_modules"), { recursive: true });
    await expect(afterPack({
      electronPlatformName: platform, appOutDir: root,
      packager: { getResourcesDir: () => resources },
    })).rejects.toThrow(/package\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
