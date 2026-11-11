# Bundled core

Upstream source: https://github.com/sealbridge/sealbridge, tag v0.7.0, commit
`77c6140c75e5fec89428727de00aca217a4cbb0c` (version `0.7.0`).
The bundled package is `sealbridge-local@0.7.0`, built from the local publish
root `dist-local` by upstream `scripts/package-cli.mjs`, with bin
`sealbridge-local` and `LOCAL_DISTRIBUTION = true`.
`sealbridge-local-0.7.0.tgz` is the published npm tarball, verified against
npm's SHA-512 integrity in `provenance.json`. This first local release was
published manually and has no npm provenance attestation; the source archive
and recorded hashes are local pinning evidence, not an npm attestation.
`provenance.json` records SHA-256 hashes; the preparation script verifies both
archives before `npm ci`. `runtime/sealbridge/package-lock.json` pins the complete
runtime dependency graph, including `@napi-rs/keyring@2.1.2` and platform natives.

`source.tar.gz` is `git archive --format=tar.gz` of that commit. To rebuild the
package, extract it into a new temporary directory, install with its frozen
`pnpm-lock.yaml` using Corepack pnpm@10.34.6, then run `pnpm run package:cli` and
`npm pack ./dist-local --ignore-scripts`. These operations must run in the temporary copy,
never in the read-only reference clone. Review and update both archive hashes
and the runtime lockfile together when upgrading.

Run `node scripts/prepare-sealbridge-runtime.mjs --all-architectures` to stage
x64/arm64 native modules for the build OS. Each architecture is installed using
npm's `--cpu` selection. Electron Builder copies the matching tree into
`Resources/sealbridge-runtime`, outside ASAR. The child uses Electron's Node via
`ELECTRON_RUN_AS_NODE=1`; it does not invoke a user's Node, npm, npx or global CLI.
The host-architecture tree is also staged for development and fixture tests.

The receive adapter projects core `INTERRUPTED` events as `TASK_INTERRUPTED` in its
existing terminal-status channel; the panel labels them as interruptions rather than rejections.
Diagnostic phases and raw error details are not forwarded to the renderer.

The adapter calls core `selectKeyStore`, `setApplicationKeyStore` and
`resolveStoredIdentity` to bootstrap the requester identity. The core's
`KeychainKeyStore` owns key generation, JWK encoding, validation, locking and
credential storage. Its native module pins Linux to Secret Service. No desktop
key format or plaintext fallback is involved. Configuration records `keychain`
using the core's own persistence API. The core receives its explicit private
data directory under the desktop's userData and a temporary isolated home.

Only public identity messages use Node IPC. MCP stays on stdin/stdout. Child
stderr is bounded and entirely replaced with a redaction marker; stdout frames
and raw exception text are never logged. The renderer has only fixed local
status/retry methods. No tools/call bridge is exposed.

Upstream Apache-2.0 LICENSE and NOTICE are included here and in the installed
package. Runtime dependencies carry their own license files. Public release
workflows remain disabled. Native keychain access, signing and packaged startup
still need acceptance on supported OS installations; automated tests use an
isolated encrypted fake keyring and never access an existing OS credential.

The invitation adapter uses core InviteStore.open/import/remove with keychain selection.
Raw credentials enter a one-shot child through stdin only. Confirmation uses the
core connectionsCommand confirm-invite with a saved reference after desktop human
confirmation; it creates limited consent and does not grant task execution.

Context preparation uses the bundled sealbridge-local/sdk exports for grant construction,
validation and digest-only audit payload projection. Preparation does not append
lifecycle events because it does not send, open or delete context.

Desktop starts only the requester `mcp-server --relay ? --require-approval`,
not a core worker, receive hook or relay wake command. Its production
core-child bootstraps the requester AcpMcpServer through the public SDK with
`requireInteractiveApproval: true` and keychain identity options. Upstream 0.7.0 gates
those execution paths in `cli/src/network.ts`; `cli/src/mcp.ts` does not call
`ensureLocalPcOptIn`. Non-interactive requester startup therefore needs no
`localPcExecution` permission. Desktop neither passes `--allow-local-pc` nor
writes that setting. Children retain their private Desktop data directory
and isolated home; mainline CLI configuration is not read. Existing workplace
prepare/decide cards, content inspection and `assertLlmAutoAccept` remain in
force. A future embedded core worker must use local HostBackend and
LocalSecretBroker and obtain explicit first-use owner permission.
