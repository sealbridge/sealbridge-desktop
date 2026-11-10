# Sealbridge Desktop

Desktop app for Sealbridge: delegate tasks to AI agents run by other people and review what comes back before it runs. Fork of OpenMausBot.

[Sealbridge](https://sealbridge.dev) · [Core project](https://github.com/sealbridge/sealbridge)

Sealbridge Desktop is a fork of [OpenMausBot](https://github.com/milind-soni/OpenMausBot),
© 2026 Milind Soni and OpenMausBot contributors. It retains the upstream Apache-2.0
license. Fork changes are recorded in [MODIFICATIONS.md](MODIFICATIONS.md).

**Early development. There are no Sealbridge Desktop releases yet. Build from source to try it.**

The app retains the upstream Electron chat interface and local agent harness.
Sealbridge is connected through Electron's local IPC bridge: device identity,
clipboard invite import, review cards, and the limited manual request flow are
available. This does not provide automatic agent delegation or a complete peer
directory. See [first-run and local services](docs/sealbridge/first-run.md) for
the chat entrance, browser setup, ports and health checks.
Some interface text and visual assets still use upstream branding. See the
[integration contracts and current limitations](docs/sealbridge/g0-contracts.md).

Identity, dedicated storage paths, disabled updates and placeholder icon replacement
are documented in [branding/README.md](branding/README.md).

## Build from source

Requirements: Node.js **24 or newer** and **pnpm 10.33.0**, as specified in
[package.json](package.json). To chat with a local agent, install and sign in to
at least one supported agent CLI, such as `claude` or `codex`.

From a local checkout of this repository, install dependencies:

```sh
pnpm install
```

Run each command below in a separate terminal from the repository root. Keep the
server and web UI running while using the Electron shell:

```sh
pnpm dev:server
pnpm dev
pnpm dev:desktop
```

The server listens on `127.0.0.1:8799` and the web UI on `http://127.0.0.1:5199`
by default. The desktop development script stages the pinned Cloudflare Tunnel
connector for the current platform before starting Electron.

Build the production web UI and typecheck the app and server:

```sh
pnpm build
```

To build a desktop package, use the script for your platform:

```sh
pnpm package:mac
pnpm package:win
pnpm package:linux
```

The macOS build requires Swift/Xcode tools. The Linux packaging target is
Ubuntu 24.04 x64. See [CONTRIBUTING.md](CONTRIBUTING.md) for development details
and [the Linux desktop guide](docs/linux-desktop.md) for platform requirements.
For server or conversation changes, follow the
[isolated verification guide](docs/verification/README.md).

## License and attribution

Sealbridge Desktop uses the same [Apache License 2.0](LICENSE) as upstream
OpenMausBot. [LICENSE](LICENSE) and [NOTICE](NOTICE) retain upstream attribution
unchanged. Third-party components retain their own licenses; see
[NOTICE](NOTICE) and [LICENSING.md](LICENSING.md).

The OpenMausBot and MausBot names and mascot are trademarks of Supamaus Software
Private Limited. Apache-2.0 does not grant trademark rights.

Not affiliated with xAI, Meta, OpenAI or Manus.

OpenMausBot has no cryptocurrency token. Any coin using the OpenMausBot, Maus, or
SupaMaus name is not created, endorsed, or affiliated with the upstream project
or its maintainer.
