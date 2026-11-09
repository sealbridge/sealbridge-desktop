# Desktop 内と外の作業場

Run the isolated full-renderer fixture on Windows:

```sh
node --experimental-strip-types scripts/verify-workplace.mjs
```

The fixture uses `launchVerificationServer`, its disposable home and fake
engine. It creates one bot and a conversation through `control-omb`, then
mounts the production App at home. A separate headless Chrome profile connects
only to this fixture. `OMB_FIXTURE_CHROME` can name another Chrome executable.
The public identity and peer are synthetic. A fixture-only HTTP bridge calls
the real memory-backed workplace controller and launches the repository's
fake workplace through the six-operation port. No provider account, real
identity keys or live app data are used.

The receipt checks home/inbox without process startup, recipient selection,
the own-detail entrance, retained conversation text and identical server
messages before/after opening the internal workplace, a named external
launch requiring its own card, no input on launch, and separate stop/force
decisions. The printed evidence directory retains `receipt.json`, the fake
server log location and `workplace.png`. All fixture-owned processes are
stopped in `finally`. The Chrome profile is retained with the evidence.

Run the port/controller and component checks:

```sh
node --test electron/workplace.node-test.mjs electron/workplace-quit.node-test.mjs
pnpm exec vitest run src/features/sealbridge/WorkplacePanel.test.ts src/features/sealbridge/DesktopHome.test.ts src/state/page-navigation.test.ts
```

The real-process test verifies byte-identical approved UTF-8 input with EOF,
no prompt file in its disposable working folder, secret-redacted output and
confirmed process-tree termination. Mock-port checks cover rejected bypass
arguments in every argument field, one-use/expired approvals, stage-zero
refusal, owner-only provenance, settings invalidation, normal-stop timeout
and a separate force-stop decision. Quit tests cover stop/leave and renewed
force confirmation. Component tests cover the same full-text card for internal
draft insertion and the T3 example's absent handoff action. The local preload
requires active owner gestures for version tests, capability confirmation and
decisions; the browser HTTP bridge does not prove Electron's gesture check.

## Scope and remaining uncertainty

Definitions, per-public-identity selection and owner-confirmed capability
checks are fields of the existing `desktop-prefs.json`; there is no separate
binding file. Editing a definition clears its checks. A version test runs
only after its own owner confirmation; it does not establish scope/retention
behavior. The owner must independently verify those before recording them.
No product-name branch enables a capability.

Only stage zero and owner-origin stage one exist. Received requests and
deliverables have no forwarding integration. The owner must not paste
received/quarantined/unchecked/expired material into the owner-only field.
The internal workplace inserts approved text into the existing draft field;
the owner still sends through the existing composer. Internal opening keeps
the conversation and starts no external process.

On Windows, Node cannot deliver a console SIGINT reliably. Normal stop uses
the existing `taskkill /T` tree mechanism without `/F`; a timeout permits a
separate confirmation before `/T /F`. On Unix the interrupt/terminate method
signals the process group. This does not establish deletion, harness-specific
cleanup, or containment of applications that independently detach from their
owned process tree. Native application-specific behavior is unverified.

The Electron home smoke still exits before window load with 4294967295 on
the implementation machine; the Chrome receipt establishes the renderer and
controller workflow, not the packaged Electron lifecycle. Claude Code, Codex
and T3 were not executed. Network closure, all-write prevention, hooks, MCP,
provider-side retention and CLI-specific stop behavior remain unverified.

Preset references checked 2026-11-09:

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference):
  print/stdin, explicit `Read,Glob,Grep` tools (no Bash/WebFetch/WebSearch),
  `dontAsk`, strict empty MCP JSON plus MCP-tool denial, and
  `--no-session-persistence`. `--bare` is not applied. User/project hooks and
  managed settings may still affect execution; the launch card says so.
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference):
  `exec -`, `--sandbox read-only`, `--ephemeral`. This example does not use
  app-server. It does not claim network or complete write containment.
- T3 has no input capability or scope/retention arguments in the example;
  its initial Full access default and unverified thread-start permissions
  are displayed. It never uses the pairing URL as a transfer channel.

Hermes is not a shipped example or bundled dependency. A user can enter any
harness into the same generic fields; ACP support is not promised.
