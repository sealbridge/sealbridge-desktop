# First run and local services

## Desktop welcome and chat

The desktop welcome prepares this device's public address and stores its key
in the OS key store. It does not sign up for a hosted workspace. A working key
store is required for this desktop entrance; unlocking it and Retry are the
recovery path. No bypass of the identity gate is offered.

After **届け先を準備する**, choose **ホームを見る**. Open **自分のエージェント →
届け先の詳細 → 作業場**, then the app's internal chat. An external workplace is
optional. A supported, signed-in local CLI is needed to actually run a chat.
The standalone web interface (`pnpm dev`) provides the upstream local chat
interface without Electron's device bridge.

## Invites: Electron, not an HTTP endpoint

The clipboard button uses preload `sealbridge.pasteInvite()` →
`sealbridge:invite-paste`. Main reads the clipboard, queues the secret locally,
and invokes the core invite importer through its private process transport.
The renderer only gets public review cards; it does not send the invite secret
to `/api/*` or MCP. An invite must still be reviewed and confirmed. Import does
not itself grant permission to execute an incoming request. A plain browser
without the Electron bridge does not show this button.

The G0 contracts document describes that milestone's deliberately unwired
adapter, not the complete current app. The current desktop includes later
identity, invite, context-pooling and workplace integration. There is still no
full peer directory or automatic delegation workflow. The current inbox uses
manual replies; opening a request does not hand it to an AI.

## Browser tools are optional

Local text chat works without agent-browser. A fresh source checkout does not
download it during dependency installation. To use browser tools, open a chat's
Browser panel and choose **Install the browser** (管理者権限のあるアプリ利用者).
That action downloads the pinned agent-browser binary, verifies its size and
digest, and installs its Chrome runtime. It needs network access and disk space.
Progress and failures appear in that panel; **Retry browser installation** retries a failed
installation. Wait until installation finishes before asking for browser work.
The action is available to an app owner/admin, not every member of a shared team.

`GET /api/config` reports `browserEngine.kind`, `installable`, `installing` and
`installError`. For headless setup, an authenticated owner can call
`POST /api/browser-engine/install` with `Content-Type: application/json` and
body `{}`, then poll that configuration. Do this only against the intended
instance. `pnpm build:browser` stages packaging assets; it is not the runtime
installation command for a running source server.

## Health and profile scope

The canonical reachability probe is `GET http://127.0.0.1:8799/api/health`.
An unauthenticated probe returns only `{ "app": "openmausbot" }`; an authorized
owner probe also includes the owned process pid, static-UI flag and capabilities.
The `app` value is a compatibility protocol identifier, not the displayed brand.
A successful probe proves reachability, not that a provider is signed in.
Use `control:omb doctor --url <fixture-url>` for engine readiness.

`GET /` returning 404 is expected on the dev API server: the web interface is
served by Vite on port 5199. `GET /api/me` and `PUT /api/me` are Team Cloud
member-profile operations, intentionally 404 on a local single-owner server.
The local profile is part of `/api/config`; no missing local `/api/me` handler
needs to be added. Team-profile rendering and desktop profile seeding use that
route only in their team context.
