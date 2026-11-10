# P2(b) SDK import migration

Base: `2afe88156a44da833b4a291f444a52927ecbe35c` (Desktop #36).
Core: `1e6f7a4fe8f6cce0aab7973eac8e85cda0723516` (core #219), version 0.6.3.

The source was archived with `git archive --format=tar.gz` into a fresh
Windows temporary directory, extracted there, and built with Node 24.21.0,
Corepack pnpm 10.34.6, `pnpm install --frozen-lockfile`, `pnpm package:cli`,
and `npm pack --ignore-scripts`. The core repository was not modified and
no registry Sealbridge tarball was used. Some upstream workspace manifests
warn that their supported Node range is >=22 <23; the build succeeded.

- Source SHA-256: `e3ea5da9c1a861725dd8bd39798bef42057659f4409189b4504900944d381a74`
- Package SHA-256: `5a0b273d031756ee914c54fa850dcd32eb162109fd6a8823260bd217586aad39`
- Runtime integrity: `sha512-rCbljfq457RWb2ze/VlqY1prchNxd35YPKm4UU3PsxAluxoLLO609FVzvrHqpGPFEPWqAj8UR8orKT/XvOLntQ==`

The runtime lock changes only that integrity. LICENSE, NOTICE and dependency
declarations match the previous bundle. cliVersion remains 0.6.3.

## Public entry resolution

`runtime/sealbridge/sdk-entry.mjs` imports `sealbridge/sdk` with Node's ESM
resolver, so the package's import export selects the entry. Runtime preparation
copies that entry with the runtime directory and copies the Desktop SDK loader
alongside each child. The loader selects the entry next to the requested
runtime's node_modules, for both development and packaged runtimes.

Bootstrap identity, key store configuration and MCP server construction,
invite storage/trust/confirmation, context preparation, context send/receive
children, audit fixtures, invite fixtures and the SDK contract checks now use
this entry. No production source names a core internal build path.

## Fixture exports still missing

The requested all-source zero-internal-import condition is not complete.
Per the task instruction to report missing exports without replacing them,
these existing fixture imports remain:

| Fixture | Internal modules | SDK exports needed |
| --- | --- | --- |
| context-send.node-test.mjs | core/index, relay/index | signPayload, startLocalRelay |
| context-receive.node-test.mjs | core/index, relay/index | digest, signEnvelope, signPayload, startLocalRelay, HttpRelayClient |
| context-redelegation.node-test.mjs | core/index, relay/index | digest, startLocalRelay |
| key-store-concurrent.node-test.mjs | core/index | signPayload, verifySigned |

The source guard runs through test:electron. It rejects internal paths in all
JS/TS sources except these four fixtures and the guard itself. An isolated
package fixture exposes only ./sdk through an import export at a different
filename, proving resolution does not depend on upstream build paths.
The two bin paths in runtime/sealbridge/package-lock.json are upstream package
metadata, not imports. The historical CLI launch example in g0-contracts.md
also names a bin path, not an import.

## Local verification

- Node G0 runtime suite: 99 passed, 1 skipped.
- Electron G0 runtime suite: 54 passed, 1 skipped.
- Related UI, fork boundary and file-size checks: 68 passed.
- Broker: 102 passed. Packaged-server smoke passed in its disposable fixture.
- lint, typecheck, locale, fork boundaries and diff whitespace checks passed.
- test:electron: 1529 passed, 27 skipped, 6 failed. All six failures reproduce
  in an isolated archive of origin/main: four lack Windows symlink permission,
  two AppImage tests cannot find mv. No test is waived or changed to hide this.

The full Vitest suite and GitHub CI results are reported in the PR.
