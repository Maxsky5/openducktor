# packages/frontend/src/contexts/

## Responsibility
Cross-tree React context providers that are too specialized for `state/` but still needed app-wide.

## Design Patterns
Provider wrappers around third-party systems. The main example is the diff-worker provider that prewarms Pierre diff workers and syntax highlighters.

## Data & Control Flow
Providers mount once near the app shell, initialize shared infrastructure, and expose that infrastructure to descendant feature components through React context.

## Integration Points
`DiffWorkerProvider.tsx`, `@pierre/diffs/react`, and the Agent Studio layout that renders markdown/diff-heavy views.
