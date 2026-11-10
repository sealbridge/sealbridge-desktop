import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("introduces the product on a fresh server while preserving health protocol identity", async () => {
  const fixture = await launchVerificationServer();
  try {
    const health = await (await fetch(fixture.info.url + "/api/health")).json() as { app: string };
    expect(health.app).toBe("openmausbot");
    const list = await (await fetch(fixture.info.url + "/api/bots?messages=0")).json() as { bots: Array<{ id: string }> };
    const messages = await runControlOmb(["messages", "--bot", list.bots[0].id, "--limit", "10", "--url", fixture.info.url]);
    expect(JSON.stringify(messages)).toContain("Sealbridge Desktop");
    const log = readFileSync(fixture.info.logPath, "utf8");
    expect(log).toContain("Sealbridge Desktop open-source edition");
    expect(log).toContain("Sealbridge Desktop server on http://127.0.0.1:");
    expect(log).toContain("Sealbridge Desktop webhook receiver on http://127.0.0.1:");
  } finally { await fixture.close(); }
}, 30_000);
