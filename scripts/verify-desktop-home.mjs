import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.versions.electron) {
  const { app, BrowserWindow, session } = await import("electron");
  const [url, output, fixtureUrl] = process.argv.slice(2);
  app.setPath("userData", join(output, "profile"));
  app.commandLine.appendSwitch("disable-background-networking");
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
    callback({ cancel: ![new URL(url).origin, new URL(fixtureUrl).origin].some(origin => request.url.startsWith(origin + "/")) && !request.url.startsWith("devtools:") });
  });
  const window = new BrowserWindow({ show: false, width: 1000, height: 850, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const until = async code => {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      if (await evaluate(code)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${code}`);
  };
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)})?.click()`);
  try {
    await window.loadURL(url);
    await until(`document.body.textContent.includes('あなたのエージェントの届け先を準備します。')`);
    await click("届け先を準備する");
    await until(`document.body.textContent.includes('届け先の準備ができました。')`);
    assert.equal(await evaluate(`document.body.textContent.includes('did:key:fixture-public-address')`), true);
    await click("ホームを見る");
    await until(`document.querySelector('h1')?.textContent === 'ホーム'`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('main h2')).map(node => node.textContent)`), ["開くのを待っている依頼", "進行中の仕事", "自分のエージェント", "つながり"]);
    assert.equal(await evaluate(`document.body.textContent.includes('署名を確認したつながりは 0 件')`), false);
    assert.equal(await evaluate(`document.querySelector('main').innerText.includes('did:key:fixture-public-address')`), false);
    await click("受信箱で確認する");
    await until(`document.querySelector('h1')?.textContent === '受信箱' && document.body.textContent.includes('開くのを待っている依頼はありません')`);
    assert.equal(await evaluate(`document.body.textContent.includes('この版は人が手で答えます。開いても AI には渡しません')`), true);
    await evaluate(`window.fixtureReceiveFailure()`);
    await until(`document.body.textContent.includes('受信箱を確認できませんでした') && !document.body.textContent.includes('開くのを待っている依頼はありません')`);
    await window.webContents.capturePage().then(image => writeFileSync(join(output, "inbox.png"), image.toPNG()));
    await window.loadURL(url);
    await until(`typeof window.fixtureKeyFailure === 'function'`);
    await evaluate(`window.fixtureKeyFailure()`);
    await click("届け先を準備する");
    await until(`document.body.textContent.includes('OSの鍵保管庫を利用できません。')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'ホームを見る').disabled`), true);
    writeFileSync(join(output, "receipt.json"), JSON.stringify({ passed: true, checks: ["first-run to home without model or workplace", "home section order", "short public address", "no invented zero connections", "inbox without Settings", "confirmed empty versus failed fetch", "key store failure blocks completion"], limitation: "Synthetic public bridge and isolated HTTP config; native key-store behavior remains covered by existing Electron tests." }, null, 2));
    console.log(`PASS desktop home fixture: ${output}`);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
} else {
  const { launchVerificationServer } = await import("./control-omb.ts");
  const { mountPreview } = await import("./testing/preview-fixture.ts");
  const fixture = await launchVerificationServer();
  const output = mkdtempSync(join(tmpdir(), "sealbridge-home-evidence-"));
  const preview = await mountPreview(fixture, { entry: "/scripts/testing/desktop-home-preview.tsx", route: "/__desktop-home.html", title: "Isolated Desktop home" });
  try {
    const child = spawn(createRequire(import.meta.url)("electron"), [fileURLToPath(import.meta.url), preview.previewUrl, output, fixture.info.url], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: output, TEMP: output, TMP: output, DISPLAY: process.env.DISPLAY },
    });
    child.stdout.on("data", data => process.stdout.write(data));
    child.stderr.on("data", data => process.stderr.write(data));
    const timeout = setTimeout(() => child.kill(), 60_000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(timeout));
    assert.equal(code, 0);
  } finally { await preview.close(); await fixture.close(); }
}
