# Local listening ports

| Default | Purpose | Probe |
| --- | --- | --- |
| `127.0.0.1:8799` | Chat HTTP API and events (`OMB_PORT`) | `GET /api/health` |
| `127.0.0.1:8800` | Separate automation webhook receiver (`OMB_WEBHOOK_PORT`, otherwise API port + 1) | `GET /health` |
| `127.0.0.1:5199` | Vite development web UI (`OMB_UI_PORT`) | Open in a browser |

The webhook receiver accepts `POST /hooks/wh_<id>` with the per-hook secret
in `Authorization: Bearer <secret>` or `x-openmaus-secret`; a capability URL
`/hooks/wh_<id>/<secret>` is also supported. Keep these secrets private.
Unknown or invalid credentials are refused before parsing a body. Payloads
may be JSON, form data or text, with a 256 KiB body limit. Accepted deliveries
enter the configured webhook automation; they are not chat API requests.

For local chat without webhook automations, disable the listener at startup:

```sh
OMB_WEBHOOK_ENABLED=0 pnpm dev:server
```

In PowerShell, set `$env:OMB_WEBHOOK_ENABLED = '0'` then run `pnpm dev:server`.
For a desktop-managed server, set it in Electron's launch environment. The API
stays available and `GET /api/webhooks` reports `ingress.available: false` and
the disabled reason. Re-enable by removing the variable and restarting.
Setting `OMB_WEBHOOK_PORT=0` selects an ephemeral port; it does not disable it.

`OMB_WEBHOOK_PUBLIC_URL` changes advertised delivery URLs, not the bind address.
The receiver remains loopback-only in the application entry point. Publishing
an ingress through a proxy or forwarding it is an explicit operator action;
do not expose both ports on the assumption that they have the same purpose.

Verification: `pnpm exec vitest run server/webhook-disabled.e2e.test.ts
server/webhook-ingress.test.ts`. The disabled test launches an isolated fixture,
checks the API/ingress status and verifies the exact paired port refuses TCP.
