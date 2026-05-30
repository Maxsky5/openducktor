# packages/path-support/

## Responsibility
Small platform-neutral utilities shared by host-side packages, CLIs, and repository scripts.

## Design Patterns
- Keep helpers dependency-free and free of Node built-in imports.
- Put environment-specific home-directory and process-platform access at caller-owned Node boundaries.
- Prefer explicit caller-owned error handling over throwing domain-specific host errors from this package.

## Data & Control Flow
Host, MCP, web, and desktop script packages import focused pure helpers from `src/index.ts`.

## Integration Points
- `@openducktor/host`
- `@openducktor/mcp`
- `@openducktor/desktop` scripts
