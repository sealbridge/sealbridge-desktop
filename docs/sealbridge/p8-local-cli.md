# Bundled local CLI (P8)

Desktop bundles `sealbridge-local@0.7.0` from upstream tag `v0.7.0`, commit
`77c6140c75e5fec89428727de00aca217a4cbb0c`. `vendor/sealbridge/README.md`
describes the archives, npm integrity comparison and lack of npm provenance
for this manually published local distribution. `provenance.json` records
both SHA-256 hashes. The runtime lock preserves the dependency graph and
selects only the `sealbridge-local` bin. LICENSE and NOTICE match the package.

The public SDK entry is `sealbridge-local/sdk`. The existing SDK loader and
requester/approval architecture are retained. `test:electron` prepares the
verified runtime before running tests, so requester startup cannot silently
skip because the bundle has not been installed.

## Local PC permission

The 0.7.0 CLI calls `ensureLocalPcOptIn` only from `cli/src/network.ts` for
worker execution/receive hooks and relay wake commands. McpHost passes
`mcp-server --relay <default> --require-approval`. The production core-child
bootstraps the same requester AcpMcpServer through the public SDK with
`requireInteractiveApproval: true` and keychain identity options. Neither that
bootstrap nor the CLI requester in `cli/src/mcp.ts` enters the execution gate.
No flag, environment
variable or setting grants local PC permission from Desktop.

The real bundled CLI test starts non-interactively with `localPcExecution`
absent and false, completes initialize/tools-list, and checks config bytes
remain unchanged. Each case uses a disposable data directory and the host's
isolated home. Mainline configuration is excluded by the existing sanitized
environment and explicit Desktop data directory. Existing prepare/decide
cards, inspection and `assertLlmAutoAccept` checks remain in effect.

A future embedded worker needs local HostBackend/LocalSecretBroker and a
first-use explicit owner confirmation. P8 adds no worker or consent UI.

## Windows acceptance (pending owner verification)

- Launch a packaged Desktop with no user Node/global CLI; verify its bundled
  Electron Node resolves `sealbridge-local@0.7.0` and the local bin outside ASAR.
- With Desktop permission unset, then false, verify requester MCP startup,
  initialize/tools-list and normal requester interaction without a TTY prompt.
- Verify workplace prepare/decide cards still require an owner decision;
  denial/cancellation prevents execution and held content remains inspected.
- Compare Desktop `config.json` before/after startup and card decisions:
  `localPcExecution` must not become true. Mainline config/identity and OS
  credentials must remain isolated from Desktop's data directory.
- No core worker is launched by P8. If a future release adds one, verify a
  visible first-use permission, refusal/cancellation, persistence only after
  explicit acceptance, and local HostBackend/LocalSecretBroker selection.

These packaged-app checks are not claimed complete by the automated fixtures.

## Automated verification

- `test:electron`: 1533 passed, 27 skipped, 4 failed on this Windows account
  with Git's `mv` on PATH. All four failures are symlink EPERM in unchanged
  cloud-sync-engine, cloud-sync-scan, elevated-install and lent-staged fixtures;
  each also fails in an isolated archive of base ba64c9de. Without Git `mv`,
  the base and this checkout additionally fail two AppImage updater tests.
- Extended bundled runtime fixtures: 104 passed, 1 skipped with Node's
  `--test-force-exit` (the existing fixtures retain handles after completion).
- Electron Node: real bundled requester unset/false cases plus keychain
  bootstrap fixtures, 9 passed using ELECTRON_RUN_AS_NODE=1 and fake keyring.
- Related status UI and fork boundary tests: 34 passed.
- lint, typecheck, Electron syntax (342 modules), branding, locale and fork
  boundary checks passed. LICENSE/NOTICE were compared against the new
  package and are byte-for-byte unchanged.

The test-only sandbox worker fixture explicitly passes `--allow-local-pc`;
production sources do not gain that flag or a permission write. Historical
P2 verification notes describe their original 0.6.3 artifact and remain dated
records rather than current bundle instructions.
