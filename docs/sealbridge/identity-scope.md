# Display identity scope

New built-in helpers are named **Sealbridge**, from `DEFAULT_BOT_NAME` in
`shared/default-bot.ts`. Their introduction says "Hey! I'm Sealbridge…".
The app, window and product name remain **Sealbridge Desktop**, from
`branding/product.json`. The helper name is independent of the product name.
The introduction interpolates that helper's actual name.
Existing helpers, personal names, histories and saved profiles are kept;
an upstream helper still named MausBot is recognized during adoption and is
not duplicated. No migration rewrites conversation text.

The server's startup and edition lines identify Sealbridge Desktop. CLI
installation errors refer to the user running this app. This is a deliberately
small first-run identity change, not a global text substitution.

The health response's `app: "openmausbot"`, `OMB_*` variables, file/wire format
markers, package tool names and upstream attribution remain compatibility
contracts. LICENSE and NOTICE remain unchanged. The vocabulary test's
**MausBot Cloud**, **the Cloud**, **Cloud desktop**, **This computer** and
**Plan page** terminology is preserved. Remaining upstream mascot, localized
help and service names require a separate product copy decision; counts of
names in a bundled dependency or translation are not a migration specification.

The approved name **Sealbridge** applies only to newly created helpers. An
existing helper named Sealbridge Desktop or a name chosen by its person keeps
that name and its history. This change does not rename a service subscription.
