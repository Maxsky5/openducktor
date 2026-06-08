# Conventions

- No fallback logic to mask failures. Fix root causes at the source layer. Propagate actionable errors instead of silent defaults, secondary probes, or alternate paths that hide broken primary behavior.
- Keep code simple. Avoid normalization/hardening unless there is a concrete product or contract reason.
- Hexagonal boundaries: ports live in core/domain layers; adapters live in infra layers. UI must not couple directly to infrastructure when contracts or host clients exist.
- Contract changes flow from `packages/contracts` first, then host/core/adapters/frontend consumers.
- Host internals are Effect-native: fallible or I/O host ports/services return `Effect.Effect<Success, Failure, Requirements>`. Promise interop belongs at explicit transport/external API boundaries.
- Expected host failures use typed errors, preferably `Data.TaggedError` or existing host error types; avoid generic `throw new Error(...)` for expected failures.
- Do not use `catchAll`, retry, fallback, or defaulting to hide broken contracts. Retrying/polling must be explicit product behavior.
- Zod in `packages/contracts` remains public schema source; do not duplicate public contracts in Effect Schema.
- Frontend reads of server/host-owned data should use TanStack Query with query keys/options under `packages/frontend/src/state/queries`; do not add ad hoc request caches or `useEffect` fetch loops when Query owns the data.
- Streaming transcript/event state, pending permissions/questions, live tool output, and other live event-driven session state do not belong in TanStack Query unless the data becomes request/response based.
- Styling uses shadcn semantic tokens and Tailwind v4. No hardcoded grayscale structural UI, no gradient component surfaces, and new UI must work in light and dark themes.
- Avoid nested ternaries in app and test code; prefer named booleans, helper functions, lookup maps, or explicit control flow.
- Bun tests: avoid module mocks when dependency injection/local fakes work. Never mock shared barrels; mock exact source module specifiers only. Restore exact module mocks; do not rely on process-wide `mock.restore()` cleanup.
- Tests that use TanStack Query must provide isolated query clients (`QueryProvider` with `useIsolatedClient`). Components/hooks using app-state hooks need explicit minimal providers.
- Do not change production APIs, constructors, options, or exported types only to make tests easier.