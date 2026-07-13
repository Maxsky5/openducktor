# 001 — Make composer refs commit-safe

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-ref-current-in-render
- **Estimated scope**: 3 production files, 3 focused test files, roughly 80 lines

## Problem

The Agent Studio composer writes values into refs during render, then stable event handlers read those refs later. React can replay or abandon a render, so a handler can observe a draft, callback, or disabled state that never committed.

```tsx
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer.tsx:680 — current
latestDraftRef.current = draft;
latestOnSendRef.current = onSend;
latestSendDisabledRef.current = sendDisabled;
```

```tsx
// packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-editor.ts:97 — current
const latestDraftRef = useRef(draft);

latestDraftRef.current = draft;
```

The draft-state hook has the same render-phase synchronization:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-draft-state.ts:82 — current
const [state, setState] = useState<ComposerDraftState>(() =>
  createInitialDraftState({ draftStateKey, persistenceIdentity, taskId }),
);
const latestStateRef = useRef(state);
const nextStateKey = toComposerDraftStateKey(draftStateKey, persistenceIdentity);

latestStateRef.current = state;
```

The composer autofocus state is also copied out of a ref during render and placed in a layout-effect dependency list:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer.tsx:450 — current
const composerAutofocusStateRef = useRef<ReturnType<typeof createComposerAutofocusState> | null>(
  null,
);
if (composerAutofocusStateRef.current === null) {
  composerAutofocusStateRef.current = createComposerAutofocusState();
}
const composerAutofocusState = composerAutofocusStateRef.current;
```

This is a hot path: text input, attachments, autocomplete, autofocus, and message submission all depend on these values.

## Target

Canonical React Doctor recipe:

> Move ref writes into an event handler or effect. Render must stay pure because React can replay or discard it. The predictable null-guarded lazy initialization pattern remains supported.

Move render-derived synchronization into layout effects so handlers see the latest committed values before browser interaction. Preserve synchronous writes that already occur inside real editor/input handlers; those are required for two sequential DOM events before the parent rerender commits.

```tsx
// agent-chat-composer.tsx — target
useLayoutEffect(() => {
  latestDraftRef.current = draft;
  latestOnSendRef.current = onSend;
  latestSendDisabledRef.current = sendDisabled;
}, [draft, onSend, sendDisabled]);
```

```tsx
// use-agent-chat-composer-draft-state.ts — target, immediately before the existing rehydration layout effect
useLayoutEffect(() => {
  latestStateRef.current = state;
}, [state]);
```

```tsx
// use-agent-chat-composer-editor.ts — target
useLayoutEffect(() => {
  latestDraftRef.current = draft;
}, [draft]);
```

Keep the editor's event-phase update:

```tsx
const applyEditResult = useCallback((result: ReturnType<typeof applyComposerDraftEdit>) => {
  if (!result) {
    return false;
  }

  clearPendingInputState();
  latestDraftRef.current = result.draft;
  // existing selection and onDraftChange behavior remains unchanged
}, [/* existing dependencies */]);
```

For autofocus, retain the canonical null-guarded initialization but read the state only inside the existing layout effect:

```tsx
const composerAutofocusStateRef = useRef<ReturnType<typeof createComposerAutofocusState> | null>(
  null,
);
if (composerAutofocusStateRef.current === null) {
  composerAutofocusStateRef.current = createComposerAutofocusState();
}

useLayoutEffect(() => {
  const composerAutofocusState = composerAutofocusStateRef.current;
  if (composerAutofocusState === null) {
    throw new Error("Composer autofocus state was not initialized.");
  }

  const autofocusResult = resolveComposerAutofocus(composerAutofocusState, {
    displayedSessionKey,
    isComposerInteractive: !isComposerInputDisabled && !isSubmitting,
    activeElement: globalThis.document?.activeElement ?? null,
    focusInsideComposer: isFocusInsideComposer(globalThis.document?.activeElement ?? null),
  });
  composerAutofocusStateRef.current = autofocusResult.nextState;
  if (autofocusResult.shouldFocus) {
    scheduleComposerFocus();
  }
}, [
  displayedSessionKey,
  isComposerInputDisabled,
  isFocusInsideComposer,
  isSubmitting,
  scheduleComposerFocus,
]);
```

Preserve the existing local variables if needed to avoid reading `document.activeElement` twice; the important target is that `composerAutofocusStateRef.current` is read inside the layout effect and is not a dependency.

## Repo conventions to follow

- Keep the existing rich-composer state ownership; do not replace refs with a second store.
- Keep `useLayoutEffect` for commit-before-interaction synchronization, matching the existing composer selection and autofocus code.
- Imitate the event-phase update already present in `packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-editor.ts:146`.
- Preserve local naming, callback stability, error toasts, failed-send restoration, and attachment staging behavior.

## Steps

1. In `agent-chat-composer.tsx`, delete the three render-phase latest-value assignments and add the `[draft, onSend, sendDisabled]` layout effect shown above.
2. Keep any existing event-handler assignment that updates `latestDraftRef` immediately after producing a new draft.
3. In the autofocus section, keep only the supported null-guarded lazy initialization during render; move the ref read into the existing autofocus layout effect and remove the render-local value from its dependencies.
4. In `use-agent-chat-composer-draft-state.ts`, move `latestStateRef.current = state` into a layout effect declared before the existing rehydration layout effect. Declaration order is required because the following effect reads the ref.
5. In `use-agent-chat-composer-editor.ts`, move prop-derived draft synchronization into a `[draft]` layout effect. Keep the write inside `applyEditResult`.
6. Update `agent-chat-composer-autofocus.test.ts` to cover one-time focus, same-session rerenders, session changes, and disabled-to-interactive transitions.
7. Update `use-agent-chat-composer-draft-state.test.ts` so a previously obtained stable callback observes the state committed after task rehydration.
8. Update `agent-chat-composer-editor.test.tsx` to prove a parent-supplied rerendered draft is edited and two sequential local edits compose before a parent commit.
9. Re-read the diff and remove unrelated ref changes.

## Boundaries

- Do not change the composer public API, draft format, persistence identity, or submission contract.
- Do not remove necessary event-handler ref writes.
- Do not use `useEffectEvent` for the ordinary submit or editor event callbacks.
- Do not change autofocus policy, selection restoration, attachment staging, or failed-send restoration.
- Do not add dependencies or suppress the rule.
- Stop if the cited code has materially drifted from commit `38620ea0f`; report the drift instead of improvising.

## Verification

- **Mechanical**:
  - `npx -y react-doctor@latest . --diff main --yes` clears the selected `no-ref-current-in-render` diagnostics without lowering the score.
  - `bun test packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-autofocus.test.ts packages/frontend/src/components/features/agents/agent-chat/use-agent-chat-composer-draft-state.test.ts packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-editor.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run --filter @openducktor/frontend test`
- **Behavior check**: In Agent Studio, type rapidly, insert chips, attach/remove files, submit, force a failed send, change sessions, and toggle disabled/interactivity. Confirm edits use the latest committed draft, failed sends restore correctly, disabled sends remain blocked, and focus is not stolen on same-session rerenders.
- **Done when**: targeted diagnostics are gone, checks pass, the React Doctor score does not regress, and composer behavior above is unchanged.
