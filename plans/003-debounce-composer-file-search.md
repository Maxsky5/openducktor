# 003 — Debounce composer file searches

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Performance
- **Rule**: Beyond the scan
- **Estimated scope**: 1 production hook, 1 focused test file, roughly 90 lines

## Problem

Every changed `@` file-reference query starts a runtime search immediately. The request ID prevents stale responses from being applied, but it does not prevent host/runtime work from starting.

```tsx
// packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-editor-autocomplete.ts:411 — current
const requestId = fileSearchRequestIdRef.current + 1;
const requestAvailabilityContext = availabilityContext;
clearFileSearchLoadingTimer();
fileSearchRequestIdRef.current = requestId;
setActiveReferenceIndex(0);
setReferenceMenuState((previousState) => ({
  textSegmentId: segmentId,
  query: match.query,
  rangeStart: match.rangeStart,
  rangeEnd: match.rangeEnd,
  results:
    previousState && previousState.textSegmentId === segmentId ? previousState.results : [],
  isLoading: true,
  showLoadingIndicator: false,
  error: null,
  availabilityContext: requestAvailabilityContext,
  requestId,
}));
```

```tsx
// use-agent-chat-composer-editor-autocomplete.ts:463 — current
void searchFiles(match.query)
  .then((results) => {
    if (fileSearchRequestIdRef.current !== requestId) {
      return;
    }
    // update current results
  })
  .catch((error) => {
    if (fileSearchRequestIdRef.current !== requestId) {
      return;
    }
    // expose current error
  });
```

TanStack Query correctly owns caching and identical-key deduplication, but each incremental string is a distinct key:

```ts
// packages/frontend/src/state/queries/runtime-catalog.ts:43 — current
repoFileSearch: ({ repoPath, runtimeKind, workingDirectory }, query) => [
  ...runtimeCatalogQueryKeys.all,
  "file-search",
  normalizeWorkingDirectory(repoPath),
  runtimeKind,
  normalizeWorkingDirectory(workingDirectory),
  query,
] as const,
```

The core and both runtime adapters do not expose a consistent cancellation contract. This plan prevents superseded searches before they start; it does not invent cancellation for already-started work.

## Target

Add a dedicated 150 ms debounce before `searchFiles`, while keeping menu feedback immediate and retaining request-ID stale-response protection.

```tsx
const FILE_SEARCH_DEBOUNCE_MS = 150;
const fileSearchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const clearFileSearchDebounceTimer = useCallback((): void => {
  if (fileSearchDebounceTimerRef.current !== null) {
    clearTimeout(fileSearchDebounceTimerRef.current);
    fileSearchDebounceTimerRef.current = null;
  }
}, []);
```

For each changed valid trigger:

1. Allocate and publish the new request ID immediately.
2. Clear the old debounce and loading-indicator timers.
3. Update reference-menu state immediately, preserving same-segment results.
4. Start the existing 500 ms loading-indicator timer immediately, measured from the user's query change.
5. Schedule the runtime request after 150 ms.
6. Inside the timer callback, check that the request ID is still current before calling `searchFiles`.
7. Keep the existing ID checks in resolution and rejection handlers because an older request may already have started.

```tsx
fileSearchDebounceTimerRef.current = setTimeout(() => {
  fileSearchDebounceTimerRef.current = null;
  if (fileSearchRequestIdRef.current !== requestId) {
    return;
  }

  void searchFiles(match.query)
    .then(/* existing guarded success path */)
    .catch(/* existing guarded failure path */);
}, FILE_SEARCH_DEBOUNCE_MS);
```

Invalidation must clear both timers and increment the request ID when the trigger disappears, the menu closes, the editor becomes disabled, support/availability changes, or the hook unmounts.

## Repo conventions to follow

- Keep `queryClient.fetchQuery` through `createChatComposerFileSearch`; TanStack Query remains the only backend-read cache.
- Keep `repoRuntimeFileSearchQueryOptions`, the full runtime/working-directory/query key, and `RUNTIME_FILE_SEARCH_STALE_TIME_MS` unchanged.
- Keep errors actionable; do not return fallback results.
- Preserve the existing delayed loading indicator and same-segment result retention.

## Steps

1. In `use-agent-chat-composer-editor-autocomplete.ts`, add `FILE_SEARCH_DEBOUNCE_MS = 150`, a separate debounce timer ref, and `clearFileSearchDebounceTimer`.
2. Do not reuse the loading-indicator timer; the two timers represent different behavior.
3. Centralize request invalidation so it clears both timers, advances `fileSearchRequestIdRef`, and resets menu state where the current code does so.
4. On a changed valid trigger, keep the current immediate state update and begin the existing loading-indicator timer immediately.
5. Move only the `searchFiles(match.query)` start into the 150 ms timer. Check the request ID before starting it.
6. Retain request-ID guards in success and failure paths.
7. Clear scheduled work when the trigger disappears, the menu closes, file search becomes unavailable, availability context changes, the editor is disabled, or the hook unmounts.
8. Update `use-agent-chat-composer-editor-autocomplete.test.tsx`:
   - rapid `@a` → `@ab` → `@abc` starts one search for `abc`;
   - closing before 150 ms starts no search;
   - unmounting before 150 ms starts no search;
   - an already-started stale request cannot overwrite a later result;
   - disabling support before start prevents the call, while disabling after start ignores its result;
   - unchanged triggers still do not repeat a request;
   - loading indication remains measured from the trigger change.
9. Keep explicit waits below the enclosing Bun test timeout and run this timing-sensitive suite sequentially.

## Boundaries

- Do not change `SearchAgentFilesInput`, core ports, runtime adapters, query keys, or stale time.
- Do not add `AbortSignal` or runtime cancellation in this plan.
- Do not add a local result cache, retry, poll, alternate search path, or silent default.
- Do not change autocomplete filtering, ranking, trigger syntax, or error semantics.
- Do not delay the local menu-state update by 150 ms.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `bun test packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-editor-autocomplete.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run --filter @openducktor/frontend test`
  - `npx -y react-doctor@latest . --diff main --yes` does not lower the score.
- **Profiler/runtime check**: Trace host/runtime calls while typing `@a`, `@ab`, `@abc`. Confirm one settled search starts. Pause long enough for an earlier query to start, then continue typing and confirm its response never replaces the later results. Confirm loading appears 500 ms after the query change, not 650 ms after it.
- **Done when**: rapid typing produces one runtime search, scheduled searches are cleared on close/unmount, stale started searches remain harmless, and all checks pass.
