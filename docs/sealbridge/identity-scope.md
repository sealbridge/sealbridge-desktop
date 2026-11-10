# Display identity scope

New built-in helpers use the product name from `branding/product.json`:
**Sealbridge Desktop**. The introduction interpolates that helper's actual
name. Existing helpers, personal names, histories and saved profiles are kept;
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

Options for a later decision are to keep the built-in helper named after the
product, give it a distinct approved assistant name, or retain the upstream
assistant identity with an explicit in-app fork disclosure. This change chooses
only the existing product name for newly created helpers. It does not rename
anyone's existing helper or service subscription.
