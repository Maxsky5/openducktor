# 009 — Make workspace branch identity commit-safe

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-ref-current-in-render
- **Estimated scope**: 4 production hooks/types, 3 focused test files, roughly 120 lines

## Problem

Workspace branch operations overwrite repository-identity refs during render, then asynchronous requests use those refs to decide whether a completion is current:

```tsx
// packages/frontend/src/state/operations/workspace/use-workspace-branch-operations.ts:46 — current
const currentWorkspaceRepoPathRef = useRef(activeRepo);
const activeWorkspaceRef = useRef<ActiveWorkspace | null>(
  activeRepo
    ? { workspaceId: "", workspaceName: "", repoPath: activeRepo }
    : null,
);

currentWorkspaceRepoPathRef.current = activeRepo;
activeWorkspaceRef.current =
  activeRepo === null
    ? null
    : { workspaceId: "", workspaceName: "", repoPath: activeRepo };
```

```tsx
// use-workspace-branch-operations.ts:135 — current
if (
  branchRequestVersionRef.current === requestVersion &&
  currentWorkspaceRepoPathRef.current === repoPath
) {
  applyBranchState(repoPath, current, allBranches);
}
```

A replayed or abandoned render can make a valid request look stale and can skip loading cleanup. The related branch-probe hook also reads/writes refs during render:

```tsx
// packages/frontend/src/state/operations/workspace/use-workspace-branch-probe.ts:47 — current
const activeRepoPath =
  activeWorkspace?.repoPath ?? branchProbeController.currentWorkspaceRepoPathRef.current;
const probeGateRef = useRef<ReturnType<typeof createProbeGateController> | null>(null);
if (probeGateRef.current === null) {
  probeGateRef.current = createProbeGateController();
}
const probeGate = probeGateRef.current;

const probeGatesRef = useRef<ProbeGates>({
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
});
probeGatesRef.current.isSwitchingWorkspace = isSwitchingWorkspace;
probeGatesRef.current.isLoadingBranches = isLoadingBranches;
probeGatesRef.current.isSwitchingBranch = isSwitchingBranch;
```

`activeWorkspaceRef` is exposed on `WorkspaceBranchProbeController` but has no consumer.

## Target

Canonical React Doctor recipe:

> Move ref writes into an event handler or effect. Render must stay pure because React can replay or discard it. The predictable null-guarded lazy initialization pattern remains supported.

Use render values directly for render decisions; synchronize refs only after commit for asynchronous listeners and stale-result guards.

```tsx
// use-workspace-branch-operations.ts — target
useLayoutEffect(() => {
  currentWorkspaceRepoPathRef.current = activeRepo;
}, [activeRepo]);
```

Change the probe API to receive repository identity directly:

```ts
type UseWorkspaceBranchProbeArgs = {
  activeRepoPath: string | null;
  // existing flags and controller
};
```

Use lazy state for the stable gate controller and commit-phase synchronization for listener snapshots:

```tsx
const [probeGate] = useState(createProbeGateController);
const probeGatesRef = useRef<ProbeGates>({
  isSwitchingWorkspace,
  isLoadingBranches,
  isSwitchingBranch,
});

useLayoutEffect(() => {
  probeGatesRef.current = {
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
  };
}, [isLoadingBranches, isSwitchingBranch, isSwitchingWorkspace]);
```

Use a layout effect because focus/visibility listeners can fire immediately after commit and must not observe the previous repository or gate flags.

Remove `activeWorkspaceRef` from the operations hook and `WorkspaceBranchProbeController`.

In the parent operations hook, remove the render-written `activeRepoRef`. Make degraded-state updates repository-explicit, for example:

```ts
const setBranchSyncDegradedForRepo = useCallback((repoPath: string, value: boolean): void => {
  // preserve the current repo-tagged state update, using repoPath explicitly
}, []);
```

Thread the request/probe repository path into that callback so a stale completion cannot accidentally tag the newly active repository.

## Repo conventions to follow

- Preserve existing TanStack Query branch loaders and request-version checks.
- Keep stable event listeners; changing transient flags must not reattach focus/visibility listeners.
- Keep repository identity explicit at async boundaries.
- Preserve typed workspace operation interfaces and existing stale-probe tests.

## Steps

1. Remove `activeWorkspaceRef` and the synthetic `ActiveWorkspace` object from `use-workspace-branch-operations.ts` and `WorkspaceBranchProbeController`.
2. Move `currentWorkspaceRepoPathRef.current = activeRepo` into a `[activeRepo]` layout effect.
3. Change `useWorkspaceBranchProbe` to receive `activeRepoPath: string | null` directly; delete its render-time fallback read from `currentWorkspaceRepoPathRef`.
4. In `use-workspace-operations.ts`, pass `activeRepo` directly and remove `resolvedActiveWorkspace` if it has no remaining consumer.
5. Replace `probeGateRef` and its render-time read with `const [probeGate] = useState(createProbeGateController)`.
6. Move all `probeGatesRef` field updates into the layout effect shown above.
7. Remove the parent `activeRepoRef` by changing degraded-state callbacks to accept the repository path that produced the outcome. Preserve repo-tagged stale-result semantics.
8. Keep request-version and repository checks in refresh/switch completion paths; only their synchronization source changes.
9. Update the branch-probe test harness so it passes `activeRepoPath` directly and contains no render-phase test-only ref assignment.
10. Preserve existing tests for stable listener attachment, stale degraded updates, stale gate completion, stale refresh outcomes, and stale failures.
11. Add a focused race: start a delayed `/repo-a` probe, rerender `/repo-b`, trigger focus immediately after commit, verify the new request uses `/repo-b`, resolve `/repo-a`, and verify it neither changes `/repo-b` degraded state nor releases `/repo-b`'s gate.

## Boundaries

- Do not redesign branch query keys, host calls, focus/visibility triggers, or branch data shape.
- Do not weaken request-version or repository-identity checks.
- Do not move stale-result guard values into render-driving state.
- Do not rewrite unrelated refs outside this branch operations/probe flow.
- Do not suppress the rule or add retries/fallbacks.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `npx -y react-doctor@latest . --diff main --yes` clears the selected render-ref diagnostics without lowering the score.
  - `bun test packages/frontend/src/state/operations/workspace/use-workspace-branch-probe.test.tsx packages/frontend/src/state/operations/workspace/use-workspace-branch-operations.test.tsx packages/frontend/src/state/operations/workspace/use-workspace-operations.test.tsx --max-concurrency=1`
  - `bun run --filter @openducktor/frontend typecheck`
  - `bun run --filter @openducktor/frontend lint`
- **Behavior check**: Switch repositories while a branch refresh/probe is pending, then trigger focus and visibility refreshes. Confirm requests use the committed repository, old completions cannot update or unlock the new repository, listeners are not reattached for transient flags, and loading state settles correctly.
- **Done when**: targeted diagnostics are clear, race tests pass, and stale outcomes remain isolated to their originating repository.
