# Web Runner Core

- Location: `packages/openducktor-web` (`@openducktor/web`); bins `web` and `openducktor-web`.
- Provides the local browser runner/web package and bundles the web shell, CLI entrypoint, and MCP entrypoint.
- Root dev command is `bun run browser:dev`, but browser-mode UI validation instructions say to ask the user to start it instead of starting it yourself.
- Package scripts: `dev`, `start`, `build`, `build:web-shell`, `build:cli`, `build:mcp`, `typecheck`, `test`, `lint`, `publish:dry-run`.
- Web build uses Vite for the shell and Bun build for CLI/MCP entrypoints.
- Depends on shared frontend, host-client, host, build-tools, Vite/Tailwind, and Effect. Keep reusable UI in `packages/frontend` and host behavior in `packages/host`.