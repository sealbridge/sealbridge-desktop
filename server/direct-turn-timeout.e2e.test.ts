import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("stops a silent direct chat at the configured limit and releases its busy state", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  try {
    const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
    const config = await fetch(`${fixture.info.url}/api/config`, {
      method: "PUT", headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ rooms: { turnTimeoutMinutes: 1 } }),
    });
    expect(config.status).toBe(200);
    const { bot } = await control("new-bot", "--name", "Timeout fixture");
    await control("send", "--bot", bot.id, "--text", "Wait silently");
    const current = async () => ((await (await fetch(`${fixture.info.url}/api/bots?messages=0`)).json()) as any).bots.find((b: any) => b.id === bot.id);
    await expect.poll(async () => (await current()).busy, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await current()).busy, { timeout: 80_000, interval: 500 }).toBe(false);
    const messages = await control("messages", "--bot", bot.id, "--limit", "20");
    expect(JSON.stringify(messages)).toContain("the turn was stopped");
  } finally { await fixture.close(); }
}, 100_000);
