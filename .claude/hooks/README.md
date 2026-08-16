# Hook safety boundary

No automatic effectful hook is enabled in the public baseline.

Future hooks may perform read-only manifest validation and secret scanning. They must be deterministic,
bounded, non-networked by default, and must not read `.env`, `.local`, `.runtime`, credentials, source
payloads, prompts, or model responses. Hooks must never approve runs, mutate definitions, promote a
resource, execute tools, write durable memory, commit, or push.
