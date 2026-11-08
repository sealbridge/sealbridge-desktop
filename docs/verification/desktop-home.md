# Sealbridge Desktop home and first run

Run the isolated renderer fixture:

```sh
node --experimental-strip-types scripts/verify-desktop-home.mjs
```

It starts its own fake-engine HTTP server, mounts the production home and
first-run components, and opens a hidden Electron window with a disposable
profile. Public bridge responses are synthetic. The completion record is saved
only to the fixture server. No workplace, provider account, real keys or live
application data are used.

The receipt checks first-run completion to home, section order, shortened public
address, unavailable connection state without a fabricated count, inbox access
without Settings, confirmed empty versus failed inbox fetches, and blocked
completion when the key store is unavailable. Evidence remains in the printed
temporary directory. Native key-store and core startup behavior are covered by
the existing `electron/sealbridge/` node tests.

On the implementation machine, Electron exited before loading the fixture with
exit code 4294967295; the existing server-connection fixture reproduced that
failure. The renderer smoke therefore remains unverified there. Component
tests, type checking and the native core tests provide narrower evidence and
do not establish the complete desktop workflow.
