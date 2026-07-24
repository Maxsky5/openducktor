# MCP startup health-probe benchmark

## Scope

This benchmark compares `main` at `295c30360fe7b2b15e7b640f2df36038d3accefc` with the startup-probe change at `cb943bc5340c34ce8c18f73d4626a6f55e1514f0`.

Each sample starts a new Bun MCP process over stdio, completes MCP initialize, calls `tools/list`, and then closes the client. Both builds use the same loopback host mock. The run uses four warmups, alternates baseline and current order, and records 100 samples for each build and workspace mode.

Environment: macOS arm64, Bun 1.3.10, 2026-07-25.

## Results

| Mode | Build | Requests | p50 | p95 |
| --- | --- | --- | ---: | ---: |
| No workspace | `main` | `GET /health`, `POST /invoke/odt_mcp_ready {}` | 62.52 ms | 64.86 ms |
| No workspace | Current | `POST /invoke/odt_mcp_ready {}` | 62.15 ms | 65.20 ms |
| Configured workspace | `main` | `GET /health`, `POST /invoke/odt_mcp_ready {}`, `POST /invoke/odt_get_workspaces {}` | 62.82 ms | 66.82 ms |
| Configured workspace | Current | `POST /invoke/odt_mcp_ready {}`, `POST /invoke/odt_get_workspaces {}` | 62.27 ms | 66.79 ms |

Without a workspace, current p95 changed by +0.34 ms (+0.52%). With a workspace, current p95 changed by -0.03 ms (-0.05%). Process startup noise dominates loopback request time, so this run shows no material process-level latency change. It does prove the required request reduction from two calls to one without a workspace and from three sequential calls to two concurrent calls with a workspace.

The result does not meet the 5 ms and 5% gate for a broader readiness/workspace contract redesign, which remains out of scope.

## Reproduce

Build `packages/openducktor-mcp/dist/index.js` from each ref in separate checkouts, then run:

```sh
bun run --filter @openducktor/mcp benchmark:startup -- --baseline /absolute/path/to/main/packages/openducktor-mcp/dist/index.js --current /absolute/path/to/current/packages/openducktor-mcp/dist/index.js --samples 100
```

The command prints JSON with the sample count, exact request paths and bodies, p50, p95, and the absolute and percentage p95 change for both workspace modes.
