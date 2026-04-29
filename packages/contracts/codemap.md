# packages/contracts/

## Responsibility
Shared runtime schemas, descriptors, config shapes, prompt shapes, and tool-name constants for OpenDucktor packages.

## Design Patterns
- Pure schema/constant package with `zod` as the validation boundary.
- Canonical enums and literal unions drive both validation and TypeScript inference.
- Contract modules are grouped by runtime descriptors, session/run payloads, MCP, workflow, and host-bridge config.

## Data & Control Flow
`src/agent-runtime-schemas.ts`, `src/agent-workflow-schemas.ts`, and `src/runtime-descriptors.ts` define runtime descriptors, roles, scenarios, and capability rules. `src/task-schemas.ts`, `src/odt-mcp-schemas.ts`, and `src/run-schemas.ts` define task, MCP, and host-facing payloads.

## Integration Points
- Imported by `packages/core`, `packages/adapters-*`, `packages/openducktor-mcp`, and `packages/openducktor-web`
- Supplies host/runtime schemas consumed by the Rust host, desktop shell, and browser launcher
