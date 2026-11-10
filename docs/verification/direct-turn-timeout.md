# Direct chat idle timeout

`rooms.turnTimeoutMinutes` is the shared idle limit for direct chat and group
turns. Actual model/tool progress restarts it. Notices, retries and session
metadata do not. Waiting for a person or computer pauses it; a running tool
retains the existing longer tool silence allowance. It is not a total wall
clock cap on productive work. `OMB_TURN_STALL_MS` remains an operator override
for the direct-chat watchdog.

Run `pnpm exec vitest run server/direct-turn-timeout.e2e.test.ts`. The test uses
`launchVerificationServer`, a disposable home, and the hanging fake Claude CLI.
It sets the limit to one minute, sends through `control:omb`, and checks that
busy clears and the transcript explains the stop. No account or real engine
is used. It takes approximately 70 seconds.

For Grok CLI, the conservative built-in default is `grok-4.5`, accepted by the
reported 1.0.77 CLI. A valid `[models].default` in that instance's
`~/.grok/config.toml` still takes precedence. Explicit saved model selections
are retained; if an existing bot selected an unsupported model, choose a model
accepted by that CLI in its model picker (or use `control:omb set-model` against
an isolated fixture). Other advertised models require support in the installed
CLI; an xAI API catalog entry alone does not establish CLI support.
