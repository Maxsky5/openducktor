# 010 — Break the app-state provider import cycle

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: MEDIUM
- **Category**: Maintainability & architecture
- **Rule**: Beyond the scan
- **Estimated scope**: 3 production files, 1 existing test file, roughly 35 lines

## Problem

The app-root provider graph contains a circular import:

```text
state/index.ts
  -> app-state-provider.tsx
  -> providers/autopilot-provider.tsx
  -> @/state (state/index.ts)
```

The cycle is created here:

```tsx
// packages/frontend/src/state/providers/autopilot-provider.tsx:15 — current
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state";
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
  useTaskSnapshotContext,
} from "../app-state-contexts";
```

`app-state-provider.tsx` imports `AutopilotProvider`, while `state/index.ts` re-exports `AppStateProvider` and `useWorkspaceState` from that same module. It currently works through ESM live bindings but makes provider initialization depend on barrel evaluation order.

The internal context seam already exists in `app-state-contexts.ts` and should own the provider-internal hook.

## Target

Add one focused internal hook:

```ts
// packages/frontend/src/state/app-state-contexts.ts — target
export const useWorkspaceStateContext = (): WorkspaceStateContextValue =>
  useRequiredContext(WorkspaceStateContext, "useWorkspaceState");
```

Delegate the public hook to it:

```ts
// packages/frontend/src/state/app-state-provider.tsx — target
export const useWorkspaceState = (): WorkspaceStateContextValue =>
  useWorkspaceStateContext();
```

Use the internal hook from the provider implementation:

```tsx
// packages/frontend/src/state/providers/autopilot-provider.tsx — target
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
  useTaskSnapshotContext,
  useWorkspaceStateContext,
} from "../app-state-contexts";

export function AutopilotProvider({ children }: PropsWithChildren): ReactElement {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceStateContext();
  // remaining behavior unchanged
}
```

Keep `App.tsx` importing `AppStateProvider` from `@/state`, and keep the public barrel exports stable. The corrected graph is:

```text
App.tsx
  -> state/index.ts
  -> app-state-provider.tsx
  -> providers/autopilot-provider.tsx
  -> app-state-contexts.ts
```

## Repo conventions to follow

- Provider implementations depend inward on `app-state-contexts.ts`, matching `useWorkspaceBranchStateContext` and `useWorkspacePresenceContext` in that module.
- Public consumers continue using `@/state`.
- Preserve the exact outside-provider error message: `useWorkspaceState must be used inside AppStateProvider`.
- Keep provider nesting and Autopilot behavior unchanged.

## Steps

1. Add `useWorkspaceStateContext` beside the existing focused workspace context hooks in `app-state-contexts.ts`.
2. Pass `"useWorkspaceState"` to `useRequiredContext` so error behavior is unchanged.
3. In `app-state-provider.tsx`, import the new internal hook, remove now-unused direct context/helper imports, and make public `useWorkspaceState` delegate to it.
4. In `autopilot-provider.tsx`, remove `import { useWorkspaceState } from "@/state"`, import `useWorkspaceStateContext` through the existing relative contexts import, and call it.
5. Leave `state/index.ts` and `App.tsx` unchanged unless a mechanical import ordering formatter touches them. Changing the app import alone does not fix the underlying cycle.
6. Update `app-state-provider.test.tsx` so public-hook/export assertions import through `./index` and confirm the exact outside-provider error remains.
7. Run the frontend boundary/module graph checks to verify the cycle is gone.

## Boundaries

- Do not remove or bypass the public state barrel.
- Do not move `AutopilotProvider` outside `AppStateProvider` or reorder providers.
- Do not duplicate raw `useRequiredContext(WorkspaceStateContext, ...)` calls across modules.
- Do not move or replace `WorkspaceStateContext`.
- Do not change Autopilot event detection, baseline handling, settings reads, or session-start behavior.
- Do not change public hook names or error messages.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `bun test packages/frontend/src/state/app-state-provider.test.tsx --max-concurrency=1`
  - `bun run frontend:boundary-guard`
  - `bun run --filter @openducktor/frontend typecheck`
  - `bun run --filter @openducktor/frontend lint`
  - `npx -y react-doctor@latest . --diff main --yes` no longer reports the cycle and does not lower the score.
- **Behavior check**: Launch the app, confirm provider initialization succeeds, workspace state reaches Autopilot, and the public `@/state` imports used by app/pages continue to work. Trigger an Autopilot-observed task transition and confirm behavior is unchanged.
- **Done when**: the module cycle is absent, public exports and error messages are stable, provider order is unchanged, and checks pass.
