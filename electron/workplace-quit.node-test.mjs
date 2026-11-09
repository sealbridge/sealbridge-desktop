import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWorkplaceQuit } from "./sealbridge/workplace-quit.mjs";
import { registerSignalQuit } from "./window-all-closed.mjs";
import { createCoreClose } from "./sealbridge/service.mjs";

test("closing with a running workplace offers stop or leave; force stop requires a second decision", async () => {
  for (const responses of [[1], [0], [0, 1], [0, 0]]) {
    const dialogs = [], stops = [];
    let quits = 0, prevented = 0;
    const guard = createWorkplaceQuit({ workplaces: () => ({ status: () => [{ running: true, name: "fixture" }], stopAll: async force => { stops.push(force); return responses.length === 1 || force; } }),
      dialog: { showMessageBox: async input => { dialogs.push(input); return { response: responses[dialogs.length - 1] }; } }, quit: () => { quits++; } });
    const event = { preventDefault: () => { prevented++; } };
    assert.equal(guard(event), true); assert.equal(guard(event), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, 2); assert.deepEqual(dialogs[0].buttons, ["止める", "残す"]);
    assert.match(dialogs[0].detail, /削除の証明にはなりません/);
    if (responses.length === 2) assert.deepEqual(dialogs[1].buttons, ["強制停止", "続ける"]);
    if (responses[0] === 1) assert.deepEqual(stops, []);
    assert.equal(quits, responses.length === 2 && responses[1] === 1 ? 0 : 1);
    if (quits) assert.equal(guard(event), false);
  }
});

test("idle shutdown asks nothing and Unix signals request one normal app quit", () => {
  let quits = 0;
  const app = { quit: () => { quits++; } }, process = new EventEmitter();
  const guard = createWorkplaceQuit({ workplaces: () => ({ status: () => [] }), dialog: {}, quit: app.quit });
  assert.equal(guard({ preventDefault: () => assert.fail("idle quit prevented") }), false);
  registerSignalQuit({ app, process });
  process.emit("SIGTERM"); process.emit("SIGINT");
  assert.equal(quits, 1);
});

test("core receive/send stay live until the desktop commits to closing, then close once", async () => {
  const calls = [];
  const close = createCoreClose({ receiver: { stop: () => calls.push("receive-stop") }, sender: { cancel: force => calls.push(["send-cancel", force]) }, service: { close: async () => calls.push("service-close") } });
  assert.deepEqual(calls, []);
  await close(); await close();
  assert.deepEqual(calls, ["receive-stop", ["send-cancel", true], "service-close"]);
});
