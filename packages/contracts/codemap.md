# packages/contracts/

## Responsibility
Shared runtime schemas, descriptors, config shapes, prompt shapes, session/run shapes, and tool-name constants for OpenDucktor packages.

## Design Patterns
- Pure schema/constant package with `zod` as the validation boundary.
- Canonical enums and literal unions drive both validation and TypeScript inference.
- Contract modules are grouped by runtime descriptors/connections, session/run payloads, prompts, MCP/workflow tools, and host-bridge config.

## Data & Control Flow
`src/agent-runtime-schemas.ts`, `src/agent-workflow-schemas.ts`, and `src/runtime-descriptors.ts` define runtime descriptors, routes, capabilities, and workflow-tool policy. `src/session-schemas.ts`, `src/run-schemas.ts`, `src/prompt-schemas.ts`, `src/config-schemas.ts`, and `src/odt-mcp-schemas.ts` define session, browser-launcher, prompt, and MCP payload shapes.

## Integration Points
- Imported by `packages/core`, `packages/adapters-*`, `packages/openducktor-mcp`, and `packages/openducktor-web`
- Supplies host/runtime schemas consumed by the Rust host, desktop shell, and browser launcher
