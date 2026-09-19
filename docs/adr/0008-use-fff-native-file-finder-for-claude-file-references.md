---
status: accepted
date: 2026-09-19
---

# Use the fff native file finder for Claude file references

## Context

The Claude runtime `@` search walks the working directory in the host process. The walker stops after 4000 visited entries, matches exact substrings only, and does not honor `.gitignore`. It returns ignored files such as `.env`, and one unreadable directory aborts the whole search.

Large repositories need ranked fuzzy results. The walker returned none for common queries because the visit limit was reached before the matching entry.

## Decision

Use `@ff-labs/fff-node` in the host Claude adapter.

- One `FileFinder` per working directory. Prewarm it when a session opens, destroy it when the last session for that directory closes, and cap live finders at three with least-recently-used eviction.
- Search with `mixedSearch`. Drop the empty root result, map directory results to `kind: "directory"`, strip the trailing slash from directory paths, normalize path separators, and limit results to 30.
- Do not fall back to another search. A finder load failure fails the session start, or surfaces through the composer error when the finder loads during a search.
- Externalize the package in the Electron main build. Unpack the fff package and the native ffi packages from the asar archive, and rewrite a resolved `app.asar` module path to `app.asar.unpacked` before loading it. fff resolves its shared library inside the archive, and ffi-rs opens it outside the Electron `dlopen` patch, so the archive path cannot work.
- Keep the OpenCode, Codex, and workspace file tree search paths unchanged.
- Keep frecency out of scope. It needs a persisted database.

## Options we rejected

- The host directory walker. It cannot rank results, it ignores no `.gitignore` file, and it stops early on large repositories.
- Codex app-server `fuzzyFileSearch` for Claude. Search belongs to the selected runtime.
- A second host-owned index. It would duplicate runtime search and need its own ignore rules.
- A patched copy of `@ff-labs/fff-node`. A local patch of a bundled third-party file breaks on every upgrade. The unpacked-path load uses public Node resolution and file system behavior instead.
- A fallback walker when the native library is missing. It hides packaging failures and returns poor results.

## Consequences

The package adds one native dependency per platform. CI must install the platform package and run the host tests under Bun. A packaged macOS build must keep the binary packages outside the asar archive.

The Electron package build verifies the unpacked payload after electron-builder. It loads the packaged module, scans a probe file, and fails the build when the payload is missing or resolves outside the packaged app. It also checks that the archive unpacks `@ff-labs/fff-node`, `ffi-rs`, and the native packages for the target platform.

Packaging needs a host that matches the target platform and architecture. The native payload only loads on its target, so the verifier rejects a cross-target run before the probe and names the required host.

The Claude service owns finder lifetime. The service prewarms the finder before it creates the session, so a load failure fails the session start with an actionable error. The cache destroys a finder released during a search when the last search settles.

## References

- [ADR 0005](./0005-use-codex-app-server-fuzzy-file-search-for-file-references.md)
- [Runtime integration guide](../runtime-integration-guide.md)
- [fff repository](https://github.com/dmtrKovalenko/fff)
