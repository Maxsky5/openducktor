# packages/contracts/

## Responsibility

Shared runtime schemas, enums, descriptors, and tool-name constants for OpenDucktor packages.

## Design Patterns

- Pure schema/constant package with `zod` as the validation boundary.
- Canonical enums and literal unions drive both runtime validation and TypeScript inference.
- Contract modules are grouped by domain: tasks, sessions, runtime, git, MCP, filesystem, prompts, and workflow.

## Data & Control Flow

- `src/index.ts` re-exports all public schema modules as the package contract surface.
- `src/agent-runtime-schemas.ts` and `src/runtime-descriptors.ts` define runtime capability/descriptor invariants.
- `src/task-schemas.ts`, `src/odt-mcp-schemas.ts`, `src/run-schemas.ts`, and related modules define the IPC payload shapes used across host and adapters.

## Integration Points

- Imported by `packages/core`, `packages/adapters-opencode-sdk`, `packages/adapters-tauri-host`, and `packages/openducktor-mcp`.
- Supplies task/workflow/runtime schemas consumed by the Rust host and desktop app IPC layers.
