import { connect } from "node:net";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("leaves the webhook port closed and reports disabled ingress while the API stays healthy", async () => {
  const fixture = await launchVerificationServer({ ...process.env, OMB_WEBHOOK_ENABLED: "0" });
  try {
    const url = fixture.info.url;
    expect((await fetch(url + "/api/health")).status).toBe(200);
    const response = await fetch(url + "/api/webhooks");
    expect(response.status).toBe(200);
    expect((await response.json()).ingress).toMatchObject({ available: false, error: "Webhook receiver disabled by OMB_WEBHOOK_ENABLED=0" });
    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) + 1 });
      socket.once("connect", () => { socket.destroy(); resolve("open"); });
      socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); resolve(error.code ?? "unknown"); });
      socket.setTimeout(5_000, () => { socket.destroy(); reject(new Error("Port probe timed out")); });
    });
    expect(status).toBe("ECONNREFUSED");
  } finally { await fixture.close(); }
}, 30_000);
