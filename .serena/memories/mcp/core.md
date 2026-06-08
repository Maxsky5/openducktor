# MCP Core

- Main MCP package: `packages/openducktor-mcp` (`@openducktor/mcp`), bin `openducktor-mcp`, source entry `src/index.ts`, build script `scripts/build.ts`.
- MCP server name is `openducktor`.
- Tool schemas are defined in `packages/openducktor-mcp/src/lib.ts` (`ODT_TOOL_SCHEMAS`).
- Workflow tools: `odt_read_task`, `odt_set_spec`, `odt_set_plan`, `odt_build_blocked`, `odt_build_resumed`, `odt_build_completed`, `odt_qa_approved`, `odt_qa_rejected`.
- Shared MCP schemas live in `packages/contracts/src/odt-mcp-schemas.ts`.
- Role-to-tool policy lives in `packages/core/src/types/agent-orchestrator.ts` (`AGENT_ROLE_TOOL_POLICY`). Workflow tool normalization is in `packages/core/src/services/odt-workflow-tools.ts`.
- Role allowlist: `spec` -> read/set spec; `planner` -> read/set plan; `build` -> read/build state tools; `qa` -> read/qa verdict tools.
- Keep MCP changes synchronized across MCP package, contracts, core policy/normalization, host/adapter bridge, and frontend Agent Studio surfaces.
- The MCP package is intended as a CLI/server surface; avoid reopening broad JS/TS library API exports unless that boundary is deliberately changed.