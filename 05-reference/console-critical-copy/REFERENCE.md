# Critical console copy

The governed artifact is [`fixtures/copy.json`](fixtures/copy.json). It is generated from the
shared copy module that the console imports, so release evidence always evaluates rendered text.

Run `npm run generate:console-copy` after an intentional copy change. Pull requests run
`npm run check:console-copy`, which rejects drift and applies credential-free readability rules.
Semantic certification is a separate release action because it requires an approved model
provider. Its result is stored in the append-only audit ledger.
