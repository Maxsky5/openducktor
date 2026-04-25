# packages/contracts/

## Responsibility

Shared runtime schemas, enums, descriptors, prompt shapes, and tool-name constants for OpenDucktor packages.

## Design Patterns

- Pure schema/constant package with `zod` as the validation boundary.
- Canonical enums and literal unions drive both runtime validation and TypeScript inference.
- Contract modules are grouped by domain: tasks, sessions, runtime, git, MCP, filesystem, prompts, workflow, and host-bridge responses.

## Data & Control Flow

- `src/index.ts` re-exports all public schema modules as the package contract surface.
- `src/agent-runtime-schemas.ts`, `src/agent-workflow-schemas.ts`, and `src/runtime-descriptors.ts` define runtime, role, scenario, and capability invariants.
- `src/task-schemas.ts`, `src/odt-mcp-schemas.ts`, `src/run-schemas.ts`, and related modules define the IPC payload shapes used across host, adapters, and the MCP host bridge.

## Integration Points

- Imported by `packages/core`, `packages/adapters-opencode-sdk`, `packages/adapters-tauri-host`, `packages/openducktor-mcp`, and `packages/openducktor-web`.
- Supplies task/workflow/runtime schemas consumed by the Rust host, desktop app IPC layers, and browser launcher/runtime config.
