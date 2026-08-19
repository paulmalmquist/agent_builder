# Start a governed Paul OS session

Read `CLAUDE.md`, validate the tracked definitions, and report:

1. whether a private profile path is configured, without printing the path or its contents;
2. the active project and exact resource versions;
3. mandatory protocols and effective deny rules;
4. available skills relevant to the user's stated task;
5. any missing dependency that requires diagnostic/read-only mode.

Do not load private source data until the user asks for a task that requires it. Do not print secrets,
private paths, connector endpoints, prompts, retrieved content, or source identifiers.
