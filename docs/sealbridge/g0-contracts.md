# G0 contracts and startup verification

This document records the G0 milestone. For the current desktop's later IPC
integration, invite review and local chat entrance, see [first run](first-run.md).

G0 adds isolated modules for product configuration, a supervised stdio MCP client,
feature negotiation, a provisional main-process adapter, an identity-store contract,
and a pinned CLI preparation experiment. It does not register IPC, launch from
`main.mjs`, add screens, or route URLs. G0 also sets the desktop package identity.

`branding/product.json` is the single source of truth for the final product name,
**Sealbridge Desktop**, package name `sealbridge-desktop`, and appId
`dev.sealbridge.desktop`, using the project's `sealbridge.dev` domain.
`product.mjs` validates, copies and freezes the configuration. The CLI package
name and version, relay, proposed scheme, and proposed data-directory name also
come from this file; the last two are not wired into the existing application.

## Package identity and remaining G2 work

Package metadata mirrors the following fields. The node:test check in
`electron/sealbridge/product.node-test.mjs` parses JSON and YAML and fails on any
disagreement. It runs through `electron/sealbridge.node-test.mjs`, the existing
Electron test entry, and the `sealbridge-desktop-g0` workflow. Edit product.json
and its corresponding metadata and checked shell literals together.

| Product field | Value | Checked consumers |
| --- | --- | --- |
| `productName` | `Sealbridge Desktop` | package.json `productName`; builder product/desktop names and NSIS shortcut; macOS resource fallback, Windows checks and shipped macOS Sentinel CLI paths; G0 adapter and MCP client |
| `packageName` | `sealbridge-desktop` | package.json `name`; DEB metadata, upgrade fixture, install-command smoke and workflow cleanup |
| `appId` | `dev.sealbridge.desktop` | electron-builder.yml `appId`; embedded CUA host, descriptor checks and smokes |
| `desktopName` | `sealbridge-desktop.desktop` | package.json `desktopName`; builder `linux.syncDesktopName: true`; main-process desktop name, autostart filename and package smokes |
| `executableName` | `sealbridge-desktop` | builder `linux.executableName` and Linux install directory; Linux launcher/removal, AppArmor paths, package smokes, CI resource paths and shipped Sentinel CLI; macOS and Windows retain the builder's product-name defaults |

Behavior changes from this metadata are intentional:

- Electron prefers package.json `productName` over `name`. Its default userData
  directory now ends in `Sealbridge Desktop`: `~/Library/Application Support/Sealbridge Desktop`
  on macOS, `%APPDATA%/Sealbridge Desktop` on Windows, and
  `${XDG_CONFIG_HOME:-~/.config}/Sealbridge Desktop` on Linux. Previously development
  launches used `openmausbot` and packaged launches used `OpenMausBot`. Preferences,
  encrypted credential records, browser/session state, and other files rooted at
  `app.getPath("userData")` use the new directory. G0 does not copy or migrate them.
  The server compile cache and the child's `OMB_USER_DATA` follow that path too.
- Package-manager identity becomes `sealbridge-desktop`; the appId changes OS
  bundle/installer identity. This is a separate package identity, with no upgrade
  or prior-install migration claim.
- The builder defaults produce `Sealbridge Desktop.app` on macOS and
  `Sealbridge Desktop.exe` on Windows. Linux uses executable `sealbridge-desktop`,
  DEB package name `sealbridge-desktop`, install root `/opt/sealbridge-desktop`,
  desktop file `sealbridge-desktop.desktop`, desktop Name `Sealbridge Desktop`,
  and generated StartupWMClass `sealbridge-desktop`. Icon artwork stays unchanged;
  the builder derives the installed Linux icon filename/key from the executable.

Linux package commands use `scripts/package-linux.mjs` and electron-builder's
`platformPackagerFactory` API. In app-builder-lib 26.15.3, `FpmTarget.build`
hardcodes `/opt/${appInfo.sanitizedProductName}`; `linux.executableName` only
sets `productFilename` and the executable, and no DEB/RPM install-directory
option exists. The factory sets only the Linux packager's `sanitizedProductName`
to the validated `executableName` before targets generate their paths and
templates. Display names and packaged `productName` stay `Sealbridge Desktop`.
Use the package commands rather than invoking `electron-builder --linux` directly.

This avoids [Electron's setuid sandbox path bug](https://github.com/electron/electron/issues/44414).
Chromium's [`SetuidSandboxHost::PrependWrapper`](https://github.com/chromium/chromium/blob/main/sandbox/linux/suid/client/setuid_sandbox_host.cc)
passes the unquoted helper path to
[`CommandLine::PrependWrapper`](https://github.com/chromium/chromium/blob/main/base/command_line.cc),
which tokenizes on spaces. With user namespaces restricted on Ubuntu 24.04,
`/opt/Sealbridge Desktop/chrome-sandbox` becomes executable `/opt/Sealbridge`,
and the zygote launch aborts. The smoke harness uses an argument array, and
the builder's launcher and shell templates quote paths correctly. Sandbox
permissions and the machine's namespace restrictions remain unchanged.

The naming-consumer audit found no root-package `pnpm --filter openmausbot` or
workspace dependency references. Filters for `@openmausbot/docs` and
`@openmausbot/control-plane` address separate packages and stay unchanged.
`scripts/release-ci.mjs` and `scripts/ci-scope.mjs` compare package metadata for
version-only changes without requiring a particular name. Their test manifests
use an independent fixture name. `scripts/build-npm-package.mjs` explicitly emits
the separate upstream headless npm package; it does not inherit the root name.
Native preparation scripts read root dependency pins, not its name.

Packaging paths now follow this identity through Linux install/removal hooks,
package verification and smokes, macOS resource lookup, Windows executable checks,
NSIS shortcuts, main-process desktop association, embedded CUA host appId, Linux
autostart and installed Sentinel CLI discovery. The builder includes `branding/product.json` in the app
archive for runtime consumers. The consistency test also checks the quoted literal
Linux hook paths and AppArmor attachment, generates a desktop entry with the
installed electron-builder to verify its Exec, icon key and window class, and
captures real DEB/RPM target arguments and generated launcher/AppArmor templates
in a temporary fixture to verify the install directory and preserved display name.

The AppArmor resource filename and profile name remain `openmausbot-browser`;
only the quoted executable attachment changes. `OPENMAUSBOT_POSTINSTALL_TEST_ROOT`
and other `OPENMAUSBOT_*` / `OMB_*` environment hooks retain their names for
compatibility. The DEB upgrade smoke uses an older-version fixture of the new
package identity to exercise preserved directory modes; it does not migrate an
installed upstream package. Full installed-package and platform smokes still need
the corresponding built artifacts and supported runners.

G2 still owns these integration points, which do not yet follow product.json:

- URL registration remains `openmausbot` in the builder and main process. The
  configured `sealbridge` scheme is only a G0 module value.
- Main and `server/config.ts` still default conversation and configuration storage
  to `~/.openmausbot` (or `OMB_DATA_DIR`), independent of package identity. The
  configured `dataDirName` does not move that directory.
- Renderer/server brand modules, HTML/web manifest, translations, helper names,
  OS permission text, icons, mascot, DMG visuals, builder artifact names and Linux
  vendor text retain existing values. Other cosmetic labels, including login-item
  display text, remain unchanged. README's upstream product and download sections
  also remain unchanged.
- The updater publish owner/repo, feed and release destinations remain unchanged.
  Release workflow changes only resolve built and installed paths; artifact names
  and publishing behavior remain unchanged. Enterprise code remains a G1 concern.

Code signing is out of scope for G0; this change performs no signing.

## Provisional adapter API

`createAdapter(options)` accepts a host/runtime and optional main-only providers:
`identityStore`, `inviteImporter`, `approvalChannel`, and `requestChannel`.
Asynchronous operations return `{ok: true, value}` or
`{ok: false, error: {code, ...}}`. Unsupported operations use
`SEALBRIDGE_NOT_SUPPORTED` and the operation name. Provider failures return
`SEALBRIDGE_OPERATION_FAILED` without copying exception text.

| Operation | G0 behavior |
| --- | --- |
| `bootstrap()` | Start host; initialize, notify initialized, list tools; return public identity if a store is injected, relay, negotiated features, and sending state. Without a provider the CLI identity is ephemeral. |
| `importInvite(secretInput)` | Unsupported on 0.2.2. An importer plus explicit import signal and alias tool are required. Only an opaque alias and public contact fields are returned. |
| `listPublicWorkers(query = "")` | Call `acp_discover_workers` and filter locally by text. Return projected directory fields. All cards have `accessMode: "unknown"`; directory membership does not establish open access. |
| `submitRequest(targetRef, draft)` | Disabled on 0.2.2. Requires delegate tool, explicit host-approval signals, approval provider and request provider. A future provider maps alias/DID arguments and returns an opaque handle. |
| `onApproval(callback)` / `answerApproval(id, decision)` | Future approval-provider subscription and correlated response; decisions are `accept`, `decline`, `cancel`. Unsupported without the negotiated contract. Subscriptions return an unsubscribe function. |
| `onStatus(callback)` | Subscribe to public bootstrap status; returns an unsubscribe function. Future lifecycle notifications require core integration. |
| `cancelRequest(handle)` / `getRequest(handle)` | Unsupported on 0.2.2; explicit capability signals and request-provider methods are required. Process termination is not a cancellation acknowledgement. |
| `close()` | Stop the host and remove local subscriptions. Never replay requests. |

Providers are trusted main-process integrations. They must enforce the eventual
core schemas, approval correlation and public DTO boundaries. They are not exposed
as renderer callbacks. G0 does not invent the pending core argument contracts.

## Feature negotiation

The recorded fixture projects protocol, server metadata, capabilities, and tool
names from an actual 0.2.2 initialize/tools/list exchange. No relay connection is
needed. Unknown features default to false; a higher version alone enables nothing.

| Contract | CLI 0.2.2 | Pending hook |
| --- | --- | --- |
| MCP | `2024-11-05`, server `sealbridge-mcp-server`, version `0.2.2` | Protocol compatibility remains explicit |
| Single/multiple delegation | `acp_delegate_task`, `acp_delegate_multi` present | GUI sending still requires host approval |
| Directory discovery | `acp_discover_workers` | Open access/card fields require an explicit extension |
| Audit/revocation/invite creation | `acp_verify_audit_bundle`, `acp_revoke_token`, `acp_inspect_revocations`, `acp_create_invite` present | No G0 adapter operations for these |
| Invite aliases/import | No `acp_list_invites`, no `accept` | Import provider consumes a transient secret through the future non-MCP input channel |
| Identity setup | No `setup`; no-key MCP identity is ephemeral | Core identity provider and private startup transport |
| Host approval | No elicitation/host contract | Approval channel and a host implementing bidirectional requests |
| Open discovery / relay authentication recovery | No negotiated contract | Runtime signals; `RELAY_AUTH_RECOVERY_EXHAUSTED` remains a core-owned result |
| Request status / cancellation | No exposed contract | Request provider after core status/acknowledgement schema agreement |

For tests and future adaptation, `capabilities.experimental.sealbridge` is a
**provisional local signal vocabulary**, not a claim about a published core API.
Boolean `hostApproval` and `elicitation` must both be true for host approval.
`openWorkerDiscovery`, `identityBootstrap`, `inviteImport`, `relayAuthRecovery`,
`requestStatus`, and `requestCancellation` are independently explicit booleans;
import additionally requires `acp_list_invites`, discovery its discovery tool.
When core publishes signals, change their mapping in `capabilities.mjs`.
The G0 host advertises empty client capabilities and rejects incoming server
requests with method-not-supported. A later approval provider must be paired with
a host implementing the agreed elicitation contract before enabling sends.

## Secret transport and OS storage contract

Raw invite input stays in transient main memory. It must not enter argv,
environment variables, MCP arguments, renderer state, conversations, or logs. The
importer receives it directly through a main-only provider call; future CLI
integration requires a dedicated private input channel. G0 does not implement
`accept` or pass an invite to an existing MCP tool. Tokens are never returned by
the adapter. Core owns invite verification and alias persistence.

Private key material stays in main and the core's agreed private startup channel.
It must not enter argv, environment variables, renderer state, or plaintext files.
`createIdentityStore` exposes only `getPublicInfo()` and `ensureIdentity()` returning
DID/public key. The injected core provider creates/restores records; this module
neither generates keys nor supplies them to 0.2.2's file-based `--key` option.
An injected store's public identity is not bound to the 0.2.2 MCP process; its
identity mode remains ephemeral until a core bootstrap contract is integrated.
Storage writes only safeStorage ciphertext, checks encryption availability,
refuses Linux `basic_text` and unknown Linux backends, and has no plaintext
fallback. Existing `readSecureCredentials` handles encrypted record reads.
Unreadable records block replacement. Creation uses an exclusive write; a losing
concurrent creator cannot overwrite the existing identity. This is a contract
stub: core record format, atomic persistence, Windows ACLs and actual OS keychain
behavior still need G3 integration tests.

The host uses an absolute Node binary and CLI JavaScript entry, an argument array,
`shell: false`, and a temporary home/cwd. It forwards only selected OS/locale
variables. It does not inherit arbitrary credentials, Node injection variables,
or CLI data-directory selectors. It starts with `--relay` from configuration and
`--require-approval`; no key file, webhook or automatic approval is supplied.
Do not treat interactive approval as the missing host-approval contract.

JSON-RPC frames have numeric request IDs, byte bounds and request deadlines.
Timeouts reject pending calls, close stdin, and force process termination after a
short grace period. There is no automatic restart/retry of non-idempotent calls.
Stdout frames are never logged. Stderr retains a bounded prefix and is redacted
before exposure, including invite schemes and private-key records/PEM. RPC/provider
error text is not copied into public errors. Discovery projects public fields and
never labels a 0.2.2 directory card as accepting open requests.

## Runtime preparation and verification

```sh
node scripts/prepare-sealbridge-runtime.mjs
node --test electron/sealbridge.node-test.mjs
node --test electron/sealbridge/live.node-test.mjs
pnpm test:electron
pnpm lint
pnpm typecheck
pnpm i18n:check
```

Preparation installs the configured CLI version into ignored
`build/sealbridge-runtime/` with npm `--ignore-scripts --omit=dev`, verifies package
name/version and CLI entry, and prints the resolved entry. This is a build-time
experiment, not an application startup download. The generated npm lock remains
in that ignored output; reproducible transitive dependency pinning remains a
packaging question. npm is invoked through Node and its JavaScript entry on both
platforms, without command shims.

The live test runs only when `SEALBRIDGE_CLI_ENTRY` is explicitly set or a prepared
runtime exists. For the supplied reference installation:

```sh
SEALBRIDGE_CLI_ENTRY=/tmp/sb022/node_modules/sealbridge/dist/cli/dist/index.js node --test electron/sealbridge/live.node-test.mjs
```

Tests launch isolated fake/real CLI processes with disposable homes and no real
keys, invite inputs, or delegation. They do not mutate an application fixture or
user data. Tests are included in the existing Electron test glob by
`electron/sealbridge.node-test.mjs`. The separate PR/manual workflow tests Linux
and Windows on Node 24, then prepares the runtime and runs live negotiation.
Actual OS storage and packaged Electron behavior are outside this verification.

For the name follow-up on 2026-11-01, lint, typecheck and i18n checks passed,
as did both product tests, including the package/builder consistency check.
The related release, Linux CI, native preparation, after-pack, installer-fixture
and server-config suites passed 338 tests with 9 skipped. A broader 12-file
Vitest run passed 529 tests, skipped 9 and failed 57, including child-process
`EPERM` errors. Additional Electron identity-consumer tests passed 33 and failed
8 with child-process `EPERM` errors. The required G0 entry failed; a diagnostic
run without test-runner process isolation passed 21 tests and failed 11. The
original committed MCP host tests reproduced the same 10 host failures in a
temporary checkout. The full Electron suite encountered failures and a Node
assertion, then stalled and was interrupted. These runs do not establish a green
full suite in this environment. All fixtures used disposable data.

The published CLI declares Node `>=22`; this experiment uses Node 24. The plan's
separate Node 22 bundling proposal remains open. `resolveRuntime` accepts a
resolved Node binary and either a development directory or packaged
`resourcesPath/sealbridge-runtime`. It does not download or select a system CLI.

## Core questions and later milestones

Confirm private identity startup transport and shared identity/alias persistence;
import input transport and alias lifetime; approval capability spelling, protocol,
correlation, rejection and expiry; open worker-card fields; recovery notifications;
and request handles, cancellation acknowledgements and duplicate prevention.
Confirm the supported bundled Node version, binary licensing, architectures,
packaging size and nested signing requirements. No automatic delegation retry is
permitted without a core replay/deduplication contract.

G1 owns enterprise removal and its build boundaries. G2 completes the remaining
product.json integrations, schemes, data paths, names and icons listed above.
G3 adds the explicit
runtime preparation step to packaging and the runtime directory/Node binary to
`extraResources`, validates packaged paths, wires lifecycle and limited IPC into
main, and connects the agreed identity/approval providers. Later milestones own
URL routing, cards and screens. LICENSE and NOTICE remain unchanged in G0.
