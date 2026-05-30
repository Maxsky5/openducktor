# apps/

## Responsibility

Application workspaces for OpenDucktor, currently including the Electron desktop shell.

## Design Patterns

- `apps/electron` owns the Electron shell, renderer bootstrap, preload bridge, desktop packaging, and Electron IPC transport.
- Shared contracts, core logic, host boundaries, adapters, and browser launcher code live under `packages/`.
- Shell packages stay thin and delegate product behavior to `@openducktor/frontend` and `@openducktor/host`.

## Data & Control Flow

Root scripts route desktop development and packaging through `apps/electron`. Runtime data flows from shared contracts/core into the Electron shell bridge and the TypeScript host layer.

## Integration Points

- `apps/electron/codemap.md`
