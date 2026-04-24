# apps/desktop/src/lib/diff/

## Responsibility
Worker bootstrap for Pierre diff rendering.

## Design Patterns
Single-purpose worker factory that isolates the third-party diff worker URL and module construction.

## Data & Control Flow
Consumers request a new `Worker`, and the provider/context layer uses it to run syntax highlighting and diff rendering off the main thread.

## Integration Points
`contexts/DiffWorkerProvider.tsx` and `@pierre/diffs` worker/runtime integration.
