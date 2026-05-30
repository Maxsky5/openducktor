# packages/contracts/

## Responsibility
Shared runtime descriptors, config/settings schemas, session/run shapes, slash-command shapes, prompt shapes, and tool-name constants for OpenDucktor packages.

## Design Patterns
- Pure schema/constant package with `zod` as the validation boundary.
- Canonical enums and literal unions drive both validation and TypeScript inference.
- Contract modules are grouped by runtime descriptors/config, session/run payloads, slash commands, prompts, MCP/workflow tools, and host-bridge settings snapshots.

## Data & Control Flow
`src/agent-runtime-schemas.ts`, `src/agent-workflow-schemas.ts`, and `src/runtime-descriptors.ts` define runtime kinds, routes, descriptors, and workflow-tool/approval capabilities. `src/config-schemas.ts` owns workspace IDs, repo/global config, settings snapshots, autopilot, kanban, theme, and reusable prompt defaults. `src/session-schemas.ts`, `src/run-schemas.ts`, `src/slash-command-schemas.ts`, `src/prompt-schemas.ts`, and `src/odt-mcp-schemas.ts` define session, browser-launch, slash-command, prompt, and MCP payload shapes.

## Integration Points
- Imported by `packages/core`, `packages/adapters-*`, `packages/openducktor-mcp`, and `packages/openducktor-web`
- Supplies host/runtime schemas consumed by the TypeScript host, Electron shell, browser launcher, adapters, and MCP package
