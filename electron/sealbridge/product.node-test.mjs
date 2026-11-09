import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";
import { parse } from "yaml";
import { product, validateProduct } from "./product.mjs";
import { linuxPackagerFactory } from "../../scripts/package-linux.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { Platform } = builderRequire("app-builder-lib");
const { LinuxTargetHelper } = builderRequire("app-builder-lib/out/targets/LinuxTargetHelper.js");
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

function linuxPackager(config = parse(read("electron-builder.yml")), options = {}, extra = {}) {
  return linuxPackagerFactory({
    config,
    metadata: JSON.parse(read("package.json")),
    options,
    framework: { name: "electron" },
    projectDir: path.resolve(import.meta.dirname, "../.."),
    ...extra,
  }, Platform.LINUX);
}

test("product configuration is validated, copied and frozen", () => {
  assert.ok(Object.isFrozen(product));
  assert.equal(product.cliVersion, "0.6.2");
  const source = { ...product };
  const copy = validateProduct(source);
  source.shortName = "changed";
  assert.equal(copy.shortName, product.shortName);
  for (const change of [{ appId: "plain" }, { packageName: "Bad Name" }, { desktopName: "../app.desktop" },
    { executableName: "../escape" }, { executableName: "Sealbridge Desktop" }, { dataDirName: "../escape" }, { cliVersion: "latest" },
    { urlScheme: "Bad:" }, { defaultRelay: "http://localhost" }, { defaultRelay: "https://user:pass@example.test" },
    { defaultRelay: "https://example.test/#fragment" }, { productName: "" }, { extra: "field" }]) {
    assert.throws(() => validateProduct({ ...product, ...change }));
  }
  assert.throws(() => validateProduct(null));
});

test("package and builder identity match branding/product.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const builder = parse(readFileSync(new URL("../../electron-builder.yml", import.meta.url), "utf8"));
  assert.equal(pkg.name, product.packageName, "package.json name");
  assert.equal(pkg.productName, product.productName, "package.json productName");
  assert.equal(pkg.desktopName, product.desktopName, "package.json desktopName");
  assert.ok(builder.files.includes("branding/product.json"), "packaged product configuration");
  assert.equal(builder.nsis.shortcutName, "${productName}", "NSIS shortcut follows builder productName");
  assert.equal(builder.linux.syncDesktopName, true);
  assert.equal(builder.appId, product.appId, "electron-builder.yml appId");
  assert.equal(builder.productName, product.productName, "electron-builder.yml productName");
  assert.equal(builder.linux.executableName, product.executableName, "electron-builder.yml linux.executableName");
  assert.equal(builder.linux.desktop.entry.Name, product.productName, "electron-builder.yml linux.desktop.entry.Name");
  for (const name of ["package:linux", "package:linux:offline", "package:linux:dir"]) {
    assert.ok(pkg.scripts[name].includes("node scripts/package-linux.mjs"), name);
  }
});

test("literal Linux install and removal paths match the product configuration", () => {
  const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const install = read("build/linux-after-install.sh");
  const remove = read("build/linux-after-remove.sh");
  const policy = read("build/linux-sealbridge-desktop-browser.apparmor");
  const appRoot = `/opt/${product.executableName}`;
  const executable = `${appRoot}/${product.executableName}`;
  assert.ok(install.includes(`APP_ROOT="${appRoot}"`));
  assert.ok(remove.includes(`update-alternatives --remove ${product.executableName} "${executable}"`));
  assert.ok(remove.includes(`[ -L /usr/bin/${product.executableName} ]`));
  assert.ok(remove.includes(`[ "$(readlink /usr/bin/${product.executableName})" = "${executable}" ]`));
  assert.ok(remove.includes(`rm -- /usr/bin/${product.executableName}`));
  assert.ok(policy.includes(`profile sealbridge-desktop-browser "${appRoot}/resources/browser-engine/chrome/chrome-headless-shell-linux64/chrome-headless-shell" flags=(unconfined)`));
  for (const hook of [install, remove]) {
    assert.ok(hook.includes("OPENMAUSBOT_POSTINSTALL_TEST_ROOT"));
    assert.ok(hook.includes("$APPARMOR_DIR/sealbridge-desktop-browser"));
    for (const [, message] of hook.matchAll(/echo "([^"\n]+)"/g)) {
      assert.ok(message.startsWith(product.productName), `installer message: ${message}`);
    }
  }
  const builder = parse(read("electron-builder.yml"));
  assert.ok(builder.linux.extraResources.some(resource => resource.from === "build/linux-sealbridge-desktop-browser.apparmor" && resource.to === "sealbridge-desktop-browser.apparmor"));
  assert.ok(install.includes("$APP_ROOT/resources/sealbridge-desktop-browser.apparmor"));
});

test("builder desktop entry and main use the same launcher identity", async () => {
  assert.equal(require("../cua-linux-runtime.cjs").HOST_BUNDLE_ID, product.appId, "embedded Linux host appId");
  const config = parse(read("electron-builder.yml"));
  const helper = new LinuxTargetHelper(linuxPackager(config));
  assert.equal(`${helper.getDesktopFileName()}.desktop`, product.desktopName);
  const desktop = await helper.computeDesktopEntry(config.linux);
  for (const line of [`Name=${product.productName}`, `Exec=/opt/${product.executableName}/${product.executableName} %U`,
    `Icon=${product.executableName}`, `StartupWMClass=${product.desktopName.replace(/\.desktop$/, "")}`]) {
    assert.ok(desktop.split("\n").includes(line), line);
  }
  const main = read("electron/main.mjs");
  assert.ok(main.includes('import { product } from "./sealbridge/product.mjs";'));
  assert.ok(main.startsWith('import "./sealbridge/app-identity.mjs";'));
  const call = read("electron/sealbridge/app-identity.mjs").match(/app\.setDesktopName\([^;]+;/)?.[0];
  assert.ok(call);
  const names = [];
  vm.runInNewContext(call, { app: { setDesktopName: name => names.push(name) }, product });
  assert.deepEqual(names, [product.desktopName]);
});

test("Linux FPM targets use a space-free root while preserving product metadata", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "sealbridge-package-layout-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const appOutDir = path.join(directory, "linux-unpacked");
  mkdirSync(path.join(appOutDir, "resources"), { recursive: true });
  let sequence = 0;
  const tempDirManager = { getTempFile: async ({ suffix }) => path.join(directory, `${sequence++}-${suffix}`) };
  const appRoot = `/opt/${product.executableName}`;
  for (const name of ["deb", "rpm"]) {
    const config = parse(read("electron-builder.yml"));
    config.publish = null;
    config[name] = { ...config[name], afterInstall: null, afterRemove: null };
    let captured;
    const packager = linuxPackager(config, {
      effectiveOptionComputed: async args => { captured = args; return true; },
    }, { tempDirManager, emitArtifactBuildStarted: async () => {} });
    assert.equal(packager.appInfo.productName, product.productName);
    assert.equal(packager.info.metadata.productName, product.productName);
    assert.equal(packager.appInfo.productFilename, product.executableName);
    const targets = [];
    packager.createTargets([name], (_, factory) => targets.push(factory(directory)));
    const [target] = targets;
    Object.defineProperties(target.helper, { icons: { value: [] }, mimeTypeFiles: { value: null } });
    await target.build(appOutDir, 1);
    const [args, desktopFile] = captured;
    assert.ok(args.includes(`${appOutDir}/=${appRoot}`), `${name} install mapping`);
    assert.ok(readFileSync(desktopFile, "utf8").includes(`Name=${product.productName}\n`));
    assert.ok(readFileSync(desktopFile, "utf8").includes(`Exec=${appRoot}/${product.executableName} %U\n`));
    for (const flag of ["--after-install", "--after-remove"]) {
      const script = readFileSync(args[args.indexOf(flag) + 1], "utf8");
      assert.ok(script.includes(`'${appRoot}/${product.executableName}'`), `${name} ${flag} launcher`);
      assert.ok(!script.includes(`/opt/${product.productName}`));
    }
    const policy = readFileSync(path.join(appOutDir, "resources/apparmor-profile"), "utf8");
    assert.ok(policy.includes(`"${appRoot}/${product.executableName}"`), `${name} Electron AppArmor attachment`);
  }
  assert.throws(() => linuxPackagerFactory({}, Platform.MAC), /Linux platform/);
});
