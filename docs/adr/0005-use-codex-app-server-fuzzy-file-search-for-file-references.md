---
status: accepted
date: 2026-06-03
---

# Use Codex app-server fuzzy file search for file references

## Context

The Agent Chat composer sends file references as structured prompt parts. File search belongs to the selected runtime. OpenCode uses its `find.files` API. Codex app-server provides `fuzzyFileSearch` and search-session messages.

The host also has file APIs for repository selection. Those APIs browse directories. Turning them into recursive fuzzy search would create a second index and could differ from Codex file-reference rules.

## Decision

Use Codex app-server `fuzzyFileSearch` in `CodexAppServerAdapter.searchFiles`.

- Add `fuzzyFileSearch` to the protocol contract, host allowlist, and app-server client.
- Resolve the active Codex runtime connection and use its working directory as the search root.
- Map file and directory matches to `AgentFileSearchResult`.
- Set `promptInput.supportsFileSearch` only when the adapter can search and encode `file_reference` and `folder_reference` prompt parts.
- Keep the first version as one request and one response so it matches `searchFiles(query)`.
- Add search sessions only if tests in large repositories show that the one-shot request is too slow.

If Codex search is missing or fails, return an adapter error. Keep the descriptor capability off until the method works. Do not fall back to host file search.

## Options we rejected

- Codex search sessions in the first version. The current composer expects one response.
- A new host-owned fuzzy search. It would duplicate runtime search and need its own index rules.
- The repository-open file browser. It is not recursive, ranked autocomplete.
- OpenCode `find.files`. Codex does not provide that API.

## Consequences

The change order is contracts, host allowlist, Codex client, adapter mapping, descriptor, and focused tests. The frontend keeps its shared file-search path and descriptor check.

If the one-shot call is too slow, extend the shared contract for Codex search sessions. Start a session when `@` search opens, update it with the query, handle session updates and completion, then stop it when search closes or runtime context changes.

## References

- [Runtime integration guide](../runtime-integration-guide.md)
- [ADR 0003](./0003-use-project-native-agent-ui-composition.md)
