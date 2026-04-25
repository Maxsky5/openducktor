# packages/frontend/src/test-utils/

## Responsibility
Test-only harnesses, mocks, and isolated fixtures for Bun/React Query/app-state testing.

## Design Patterns
Reusable mock modules and wrappers for query-client isolation, clipboard/toast seams, session-message fixtures, and module-mock cleanup guardrails.

## Data & Control Flow
Tests import these helpers to build isolated providers and state snapshots instead of mutating global app singletons directly.

## Integration Points
`isolated-query-wrapper.tsx`, `app-state-provider-mock.ts`, `react-hook-harness.tsx`, `mock-toast.ts`, `mock-clipboard.ts`, and module cleanup helpers.
