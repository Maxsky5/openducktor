# 002 — Purify live transcript overlay updates

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-ref-current-in-render, react-doctor/no-impure-state-updater
- **Estimated scope**: 1 production hook, 2 focused test files, roughly 100 lines

## Problem

The readonly live-transcript overlay writes subscription inputs into refs during render:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-live-overlay.ts:100 — current
const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);
const baseSessionRef = useRef(baseSession);
const replyAgentApprovalRef = useRef(replyAgentApproval);
const subscribeSessionEventsRef = useRef(subscribeSessionEvents);
baseSessionRef.current = baseSession;
replyAgentApprovalRef.current = replyAgentApproval;
subscribeSessionEventsRef.current = subscribeSessionEvents;
```

It also mutates `liveStateRef` from inside React state updater callbacks:

```tsx
// use-runtime-transcript-live-overlay.ts:113 — current
setLiveState((current) => {
  if (!current?.hasRuntimeEvents || !matchesAgentSessionIdentity(current.session, target)) {
    return current;
  }
  const nextState = {
    ...current,
    session: mergeBaseSessionIntoLiveOverlay(baseSession, current.session),
  };
  liveStateRef.current = nextState;
  return nextState;
});
```

```tsx
// use-runtime-transcript-live-overlay.ts:202 — current
setLiveState((current) => {
  const currentSession =
    current?.session && matchesAgentSessionIdentity(current.session, target)
      ? current.session
      : createEmptyReadonlyRuntimeSessionState(target);
  const nextState: RuntimeTranscriptLiveState = {
    session: mergeReadonlyRuntimeHistory(currentSession, history),
    hasRuntimeEvents: current?.hasRuntimeEvents ?? false,
    error: current?.error ?? null,
  };
  liveStateRef.current = nextState;
  return nextState;
});
```

The synchronous ref is legitimate because runtime events can arrive back-to-back before React commits another render. The defect is how values are synchronized and where side effects occur.

## Target

Canonical React Doctor recipes:

> Move ref writes into an event handler or effect. Render must stay pure because React can replay or discard it. The predictable null-guarded lazy initialization pattern remains supported.

> Keep state updater callbacks pure and return only the next state. Move notifications, storage, timers, ref writes, and other external work into the event or effect that queues the update.

Retain one synchronous live-state ref and centralize state/ref commits in a value-based callback:

```tsx
const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);

const commitLiveState = useCallback((nextState: RuntimeTranscriptLiveState | null): void => {
  liveStateRef.current = nextState;
  setLiveState(nextState);
}, []);
```

Every caller must compute a complete next value before calling `commitLiveState`; the helper must not accept a `SetStateAction`.

Use React 19.2 Effect Events for effect-owned access to the latest committed subscription inputs:

```tsx
const readBaseSession = useEffectEvent(() => baseSession);
const subscribeToSessionEvents = useEffectEvent(
  (input: Parameters<typeof subscribeSessionEvents>[0], listener: Parameters<typeof subscribeSessionEvents>[1]) =>
    subscribeSessionEvents(input, listener),
);
const replyToAgentApproval = useEffectEvent(
  (...args: Parameters<typeof replyAgentApproval>) => replyAgentApproval(...args),
);
```

Adapt the exact parameter typing to the existing imported types rather than introducing unreadable inline types. Do not put Effect Events in the subscription effect dependency array.

Compute projected-session and history merges from `liveStateRef.current`, outside React updater callbacks:

```tsx
useEffect(() => {
  if (!baseSession || target === null) {
    return;
  }
  const current = liveStateRef.current;
  if (!current?.hasRuntimeEvents || !matchesAgentSessionIdentity(current.session, target)) {
    return;
  }
  commitLiveState({
    ...current,
    session: mergeBaseSessionIntoLiveOverlay(baseSession, current.session),
  });
}, [baseSession, commitLiveState, target]);
```

The history effect follows the same pattern: read the synchronous ref, derive the complete `RuntimeTranscriptLiveState`, then pass the value to `commitLiveState`.

## Repo conventions to follow

- Keep event-driven transcript assembly in local React state, not TanStack Query.
- Preserve the synchronous `readSession`/`applySessionEvent` contract in `packages/frontend/src/state/operations/agent-orchestrator/events/transient-session-events.ts:13`.
- Imitate the existing `useEffectEvent` usage in `packages/frontend/src/components/features/agents/agent-chat/agent-chat.tsx:52`.
- Preserve actionable errors and exact subscription teardown behavior.

## Steps

1. Import `useCallback` and `useEffectEvent` from React as needed.
2. Remove `baseSessionRef`, `replyAgentApprovalRef`, `subscribeSessionEventsRef`, and all render-phase assignments to them.
3. Retain `liveStateRef` and add the value-based `commitLiveState` callback shown above.
4. Route observer initialization, reset, event application, subscription errors, projected-session merges, and history merges through `commitLiveState`.
5. Remove any effect whose only job is mirroring `liveState` into `liveStateRef`; the commit helper now owns both updates synchronously.
6. Replace base-session and operation callback refs with Effect Events. The subscription effect must remain keyed only by stream identity (`repoPath`, `sessionRef`, `shouldObserve`, `target`, and stable local helpers).
7. Rewrite the projected-session and history effects so no functional state updater mutates a ref or performs external work.
8. Preserve `isCancelled`, late-subscribe cleanup, and exactly-once unsubscribe behavior.
9. Add `use-runtime-transcript-live-overlay.test.tsx` with cases for latest projected data without resubscription, history/live merging, refreshed callbacks without resubscription, and exactly-once unsubscription.
10. Retain and rerun the focused integration cases in `use-runtime-transcript-session-history.test.tsx`.

## Boundaries

- Do not remove the synchronous live-state ref.
- Do not move transcript/event-stream state into TanStack Query.
- Do not change the transient-session event adapter contract.
- Do not resubscribe merely because projected session data or operation callback identities changed.
- Do not add retries, polling, fallback history, or swallowed errors.
- Do not alter session identity matching or merge semantics.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `npx -y react-doctor@latest . --diff main --yes` clears the selected render-ref and impure-updater diagnostics without lowering the score.
  - `bun test packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-live-overlay.test.tsx packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run --filter @openducktor/frontend test`
- **Behavior check**: Open an active readonly transcript, receive live events, refresh projected state, load history, refresh operation contexts, and navigate away. Confirm streamed and historical content merge, only one subscription remains active, current callbacks are used, failures stay visible, and teardown runs once.
- **Done when**: selected diagnostics are clear, checks pass, no subscription churn is introduced, and live/history data remains consistent.
