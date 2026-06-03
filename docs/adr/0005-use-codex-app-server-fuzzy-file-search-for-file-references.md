---
status: accepted
date: 2026-06-03
---

# Use Codex App-Server Fuzzy File Search for File References

OpenDucktor will implement Codex file-reference autocomplete through Codex app-server `fuzzyFileSearch`, not through a new host-owned recursive file search. File search is a runtime-owned prompt-input capability in OpenDucktor, and Codex now exposes a native app-server search surface that can return file and directory matches fast enough for composer autocomplete while preserving runtime-specific prompt translation inside the Codex adapter.

## Context

The Agent Chat composer already models file references as structured prompt parts, and the runtime integration guide already treats file search as a runtime-owned optional prompt-input surface. OpenCode satisfies that surface through its native `find.files` API. Codex differs from OpenCode because it does not expose the same SDK API shape, but current Codex app-server does expose `fuzzyFileSearch` plus experimental search-session requests and notifications.

OpenDucktor also has host filesystem APIs used when users open repositories, but that surface is directory-browsing oriented and belongs to repository selection. Reworking it into a recursive, cached, fuzzy composer search would duplicate runtime search behavior, add another indexing owner, and risk diverging from Codex's own file-reference semantics.

## Decision

Use Codex app-server `fuzzyFileSearch` as the Codex adapter's file search implementation.

Concretely:

- add `fuzzyFileSearch` to the Codex app-server protocol contract, host method allowlist, and Codex app-server client,
- implement `CodexAppServerAdapter.searchFiles` by resolving the active Codex runtime connection and calling `fuzzyFileSearch` with the current working directory as the search root,
- map Codex file and directory results into core `AgentFileSearchResult` values,
- enable Codex `promptInput.supportsFileSearch` only when the adapter can both search files and encode structured `file_reference` and `folder_reference` prompt parts,
- keep the first implementation request/response shaped so it fits the existing composer `searchFiles(query)` contract,
- treat Codex search-session APIs as a follow-up optimization if measured latency in large repositories is not good enough.

Do not silently fall back to host-owned file search when Codex search is unavailable. A missing or failing Codex search method should produce an actionable adapter/runtime error, or the descriptor should keep file search disabled until the capability is actually implemented.

## Considered Options

- Codex app-server `fuzzyFileSearch`. Accepted because it is Codex-native, uses Codex's own fuzzy file-search implementation, supports file and directory match types, and keeps runtime-specific behavior behind the Codex adapter.
- Codex app-server search sessions from the first slice. Rejected for the initial implementation because the current OpenDucktor composer contract is request/response based. Search sessions remain the right next step if autocomplete latency needs streaming or incremental updates.
- New OpenDucktor host-owned fuzzy file search. Rejected as the Codex default because it would duplicate runtime-owned search, require a new indexing and invalidation owner, and conflate repository-opening filesystem browsing with composer file-reference autocomplete.
- Reuse OpenDucktor's existing repository-open filesystem search. Rejected because that API is not a recursive, ranked, repo-scoped autocomplete surface.
- Reuse OpenCode `find.files`. Rejected because it is an OpenCode-specific API shape and Codex does not expose it.

## Consequences

Codex file-reference work should be scoped to the existing runtime boundary: contracts first, then host request allowlisting, Codex client support, adapter mapping, runtime descriptor enablement, and focused tests across those seams.

The frontend should keep using the shared composer file-search path and runtime descriptor gating. It should not grow Codex-specific filesystem traversal logic.

If the one-shot `fuzzyFileSearch` path is too slow in real repositories, the next architectural slice is to extend OpenDucktor's composer/search contract for Codex app-server search sessions: start one session when the user enters an `@` search, update it on query changes, consume `fuzzyFileSearch/sessionUpdated` and `fuzzyFileSearch/sessionCompleted`, and stop it when the autocomplete closes or the runtime context changes.

Relevant references:

- [Runtime integration guide](../runtime-integration-guide.md)
- [ADR 0003: Use Project-Native Agent UI Composition](./0003-use-project-native-agent-ui-composition.md)
