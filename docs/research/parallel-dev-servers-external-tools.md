# Parallel OpenDucktor development servers: external-tool research

Date: 2026-08-14; implementation update: 2026-08-15

Status: the native multi-instance design from this report is implemented in the current worktree; external URL tools remain out of scope.

## Decision

OpenDucktor now owns development instance isolation. Workspace Browser and Electron commands ask the OS for free ports, log the bound URLs, derive one stable mode-specific instance ID from the canonical worktree path, and isolate Electron profiles and MCP discovery by that ID.

Portless is not part of the technical solution. It can still add a named browser URL later, but the raw loopback URLs already support parallel worktrees without an external service.

## Previous OpenDucktor behavior

This section records the 2026-08-14 baseline that caused the parallel-run failures. Its source links point to baseline commit `07692a5bf8b4c5549f993d99a795c34750deb920`, before the implementation changed these files.

### Browser mode

- The browser CLI defaults to frontend port `1420` and backend port `14327`; explicit `--port` and `--backend-port` accept only `1-65535`, so port `0` is not a request for OS allocation. See the [baseline browser CLI](https://github.com/Maxsky5/openducktor/blob/07692a5bf8b4c5549f993d99a795c34750deb920/packages/openducktor-web/src/cli.ts).
- The launcher builds both loopback URLs before it starts either listener, starts the TypeScript host on the backend port, waits for readiness, and then starts Vite. Vite binds `127.0.0.1` with `strictPort: true`. See the [baseline browser launcher](https://github.com/Maxsky5/openducktor/blob/07692a5bf8b4c5549f993d99a795c34750deb920/packages/openducktor-web/src/launcher.ts).
- The frontend receives the backend URL and token from a Vite middleware response, so both allocated ports must be known before Vite starts. The current `bun run scripts/dev.ts` command is not a direct Vite command that Portless can rewrite safely.
- The backend accepts only an explicit `http` origin on `127.0.0.1`, `localhost`, or `[::1]`, and its allowed-origin set preserves the frontend port. See [`packages/openducktor-web/src/typescript-host-backend-support.ts`](../../packages/openducktor-web/src/typescript-host-backend-support.ts) lines 158-230.
- The session endpoint sets an `HttpOnly; SameSite=Strict` cookie. A new HTTPS or named-host browser origin cannot call the current direct HTTP backend as a drop-in change: mixed-content, CORS, and same-site cookie rules require a same-origin proxy layout or an explicit contract change. See [`packages/openducktor-web/src/typescript-host-backend.ts`](../../packages/openducktor-web/src/typescript-host-backend.ts) lines 615-625.

### Electron mode

- Electron defaults the renderer to port `1430`; `ELECTRON_RENDERER_DEV_PORT` can select another port, but `0` is rejected. See the [baseline Electron config](https://github.com/Maxsky5/openducktor/blob/07692a5bf8b4c5549f993d99a795c34750deb920/apps/electron/src/effect/electron-config.ts).
- The dev script creates Vite with `strictPort: true`, resolves its loopback URL, and spawns Electron with that value in `VITE_DEV_SERVER_URL`. See [`apps/electron/scripts/dev.ts`](../../apps/electron/scripts/dev.ts) lines 431-496.
- Every development instance resolves the same `electron-profile-dev` directory under the selected OpenDucktor config root and assigns it to both `userData` and `sessionData`. There is no application single-instance lock in this path, but parallel processes still share profile and session state. See the [baseline Electron app identity](https://github.com/Maxsky5/openducktor/blob/07692a5bf8b4c5549f993d99a795c34750deb920/apps/electron/src/main/electron-app-identity.ts).
- Unpackaged Electron selects development MCP discovery, and browser workspace mode does the same. Both write one `runtime/mcp-bridge-dev.json`, so the last writer becomes the standalone development host. See [`apps/electron/src/main/electron-host.ts`](../../apps/electron/src/main/electron-host.ts) lines 15-26 and [`packages/host/src/adapters/mcp/mcp-bridge-discovery-file.ts`](../../packages/host/src/adapters/mcp/mcp-bridge-discovery-file.ts) lines 8-27.
- `OPENDUCKTOR_CONFIG_DIR` can change the config root; without it, all worktrees use `~/.openducktor`. See [`packages/host/src/config/openducktor-config-dir.ts`](../../packages/host/src/config/openducktor-config-dir.ts) lines 52-58.

### Previous manual workaround

The current scripts already accept enough input for a manual parallel trial. In each browser worktree, run a distinct pair such as `bun run browser:dev --port 1421 --backend-port 14328`; in each Electron worktree, set a distinct renderer value such as `ELECTRON_RENDERER_DEV_PORT=1431 bun run electron:dev`.

Unique ports remove the bind conflicts, but they do not give full instance isolation. Setting a unique `OPENDUCKTOR_CONFIG_DIR` for each command also isolates the Electron profile and development MCP discovery file, but it isolates all configuration-root data, including settings, logs, and workspace task stores. Keeping the shared root preserves that data but leaves Electron profile sharing and last-writer MCP discovery. This trade-off makes the manual commands a useful trial, not the final design.

## Implemented native instance contract

1. `bun run browser:dev` starts Vite and the host backend on port `0`, reads both bound ports, injects the exact backend URL into runtime config, and logs the copyable frontend and backend URLs.
2. `bun run electron:dev` starts its Vite renderer on port `0`, passes the resolved URL to Electron, and logs the copyable renderer URL.
3. Both dev wrappers derive `browser-<hash>` or `electron-<hash>` from the canonical worktree path. Electron passes it to the app process as `OPENDUCKTOR_DEV_INSTANCE`; Browser passes it through launcher options into the host process environment.
4. Electron development profiles use `runtime/dev-instances/<instance-id>/electron-profile`, while settings and task stores remain under the shared config root.
5. Development MCP discovery uses `runtime/dev-instances/<instance-id>/mcp-bridge.json`; missing or invalid development identity fails with an actionable error and never falls back to another instance.
6. Electron development mode claims one application instance per worktree. A second launch in the same worktree exits, while Electron runs from different worktrees remain independent.

## External-tool comparison

| Tool | Core method | Process and URL behavior | OpenDucktor fit | Main limit |
| --- | --- | --- | --- | --- |
| Portless `0.15.5` | One local HTTP/2 and HTTPS reverse proxy maps worktree-aware hostnames to child ports | Wraps a command, assigns one free port from `4000-4999`, injects `PORT`, `HOST`, and `PORTLESS_URL`, proxies HTTP and WebSockets, and cleans routes with owner PIDs | Best optional front door for browser mode after native allocation | One assigned app port does not solve OpenDucktor's two browser listeners, Electron profile state, or MCP discovery |
| Worktrunk `0.68.0` | Worktree manager with hook templates and deterministic `hash_port` values in `10000-19999` | `wt step tether` ties a long-running step to a worktree; an optional Caddy recipe adds names | Good small recipe if the team also wants Worktrunk | Hash ports are not a central reservation, and OpenDucktor must still wire two ports and state identity |
| Git Treeline `0.48.0` | Central registry assigns a port block and writes an environment file | Can supervise services and add an optional HTTPS router; `gtl release` frees the allocation | Strongest external allocator if OpenDucktor wants committed port-block policy | Adds a second environment registry and broader database or service features that OpenDucktor may not need |
| Paseo | Full agent daemon and client platform with worktree services | Gives a service `PASEO_PORT`, a per-worktree reverse-proxy URL, and WebSocket proxying | Technically complete for sessions it owns | It overlaps OpenDucktor's product scope and uses AGPL-3.0, so adoption would be a product and license decision |
| Coasts | Full local environment isolation with dynamic host ports and optional containers | Runs many worktree environments and lets one checked-out environment bind canonical ports | Useful for a container-heavy full-stack project | Much heavier than this need, macOS-first, and requires a broad Rust, Docker, Node, and `socat` workflow |
| Port Zero | Processes bind port `0`, then receive a stable `*.portzero.local` worktree domain | Local mode is GPLv3 and cloud sharing is optional | OpenDucktor now supports the required port model | It adds a licensed naming layer but does not improve native profile or MCP isolation |

### Portless in detail

`portless run` detects linked worktrees and prefixes the inferred or configured app name with the last branch-name segment, for example `fix-ui.openducktor.localhost`. It lowercases and sanitizes the segment, and it hashes only labels that exceed 63 characters; `feature/auth` and `bugfix/auth` therefore both become `auth` and can collide. The direct `portless <name> <cmd>` form does not apply the same worktree inference, so an integration must use `portless run --name openducktor ...`. See the [Portless worktree documentation](https://github.com/vercel-labs/portless#git-worktrees) and [worktree source](https://github.com/vercel-labs/portless/blob/v0.15.5/packages/portless/src/auto.ts#L157-L304).

Portless supports Bun workspaces and recognizes direct Vite, `bunx vite`, and one level of `bun run <script>` indirection. For Vite it injects `--port`, `--strictPort`, and `--host 127.0.0.1`, and version `0.15.5`, released on 2026-07-30, fixed WebSocket over HTTP/2. OpenDucktor's browser script runs its own Bun launcher, which then creates both the backend and Vite in-process, so Portless cannot discover and rewrite the two internal ports. See the [framework source](https://github.com/vercel-labs/portless/blob/v0.15.5/packages/portless/src/cli-utils.ts#L1069-L1184), [injection source](https://github.com/vercel-labs/portless/blob/v0.15.5/packages/portless/src/cli-utils.ts#L1306-L1356), and [release](https://github.com/vercel-labs/portless/releases/tag/v0.15.5).

Portless probes a free child port, releases the probe socket, and starts the child, so a time-of-check/time-of-use race remains across parallel starts. Its file-locked route store prevents duplicate hostnames, not duplicate backend-port selection. An open issue also reports a hostless probe selecting a port already occupied on one loopback family. See the [port allocator](https://github.com/vercel-labs/portless/blob/v0.15.5/packages/portless/src/cli-utils.ts#L736-L781) and [issue #288](https://github.com/vercel-labs/portless/issues/288).

Portless supervises the wrapped command, removes PID-owned routes, and offers `portless prune` for children left after a crash. Open reports remain for cold Vite loads and Turbo shutdown or duplicate-route behavior, so a pinned pilot must test these cases rather than assume the latest version fixes them. See [issue #370](https://github.com/vercel-labs/portless/issues/370), [issue #322](https://github.com/vercel-labs/portless/issues/322), and [issue #332](https://github.com/vercel-labs/portless/issues/332).

The project is active but young and pre-1.0. npm lists `0.15.5`, Node.js `>=24`, macOS, Linux, and Windows, Apache-2.0, and no runtime dependency list; the README warns that its state format can change. Local HTTPS creates and trusts a CA, port `443` may require administrator access, and startup-service support writes `launchd`, `systemd`, or Task Scheduler configuration. See the [npm package](https://www.npmjs.com/package/portless), [package metadata](https://github.com/vercel-labs/portless/blob/v0.15.5/packages/portless/package.json), and [HTTPS and service documentation](https://github.com/vercel-labs/portless#http2--https).

### Worktrunk

Worktrunk is primarily a worktree manager, not a proxy. Its official dev-server recipe applies the `hash_port` template filter to a stable worktree key, producing a value in `10000-19999`, exports that value through a hook, starts the server with `wt step tether`, and can register an optional Caddy route. This is easy to audit and has little runtime machinery, but deterministic hashing can collide and does not reserve a pair of ports. See the [Worktrunk repository](https://github.com/max-sixty/worktrunk) and [official tips and patterns source](https://docs.rs/crate/worktrunk/latest/source/docs/content/tips-patterns.md).

Worktrunk is the best small option if OpenDucktor wants a shared worktree CLI and is willing to keep all instance allocation logic in repository hooks. It does not help users who create worktrees through other tools, and it does not isolate Electron or MCP state unless the hook also sets an instance-specific `OPENDUCKTOR_CONFIG_DIR`.

### Git Treeline

Git Treeline commits project needs in `.treeline.yml`, keeps user allocation policy in a machine config, and records live port blocks in a central `registry.json`. `gtl setup` allocates the next block and writes an environment file; `gtl release` frees it. The project also offers service supervision and an optional HTTPS router. See the [Git Treeline repository and official README](https://github.com/git-treeline/cli).

This model matches OpenDucktor's need for two coordinated browser ports better than a single-port proxy or a hash. It is still an external source of allocation state, so OpenDucktor would need a clear error when the generated environment is absent and must not fall back to the fixed defaults during a requested multi-instance launch.

### Paseo

Paseo creates and owns worktree-backed workspaces under its daemon. A configured long-running service receives `PASEO_PORT`, and Paseo exposes that service through a worktree URL with WebSocket proxy support. See the [Paseo repository](https://github.com/getpaseo/paseo) and [worktree service documentation](https://github.com/getpaseo/paseo/blob/main/public-docs/worktrees.md).

Paseo solves more than ports: it manages worktrees, agents, terminals, services, teardown, desktop and mobile clients, and remote access. OpenDucktor already owns much of this product area, so Paseo is useful design evidence but is not a narrow dependency. Its AGPL-3.0 license also needs explicit review before integration or reuse.

### Coasts

Coasts runs many isolated worktree environments, supports Docker Compose or non-Docker setups, allocates dynamic inspection ports, and can check out one environment onto canonical host ports. It is offline-first and MIT-licensed, but its current workflow is macOS-first and brings a larger Rust, Docker, Node, and `socat` stack. See the [Coasts repository and official README](https://github.com/coast-guard/coasts).

Coasts is a fit when the goal expands to full databases, queues, containers, and network topology per worktree. It is too broad for the current OpenDucktor need, where the main conflicts are three dev ports, one Electron profile, and one discovery record.

### Port Zero

Port Zero asks each server to bind port `0`, discovers the assigned socket, and gives it a stable `*.portzero.local` domain that can include worktree identity. Its local implementation is GPLv3 and free; cloud tunnels are optional paid features. See the [Port Zero site](https://www.portzero.net/) and [local repository license](https://github.com/PortZeroNetwork/portzero/blob/staging/LICENSE).

OpenDucktor now uses this OS-assigned port model without Port Zero. The Browser launcher starts Vite, reads its bound port, starts the backend with that exact frontend origin, reads the backend port, and then exposes runtime config. Port Zero could add a name, but it is not needed for parallel execution.

## Recommended design direction

### Phase 1: native multi-instance contract — complete

The workspace commands now create one explicit development instance at the command boundary. Installed Browser launches keep the fixed public defaults for compatibility, while workspace development uses OS-assigned ports and fails when identity or isolation cannot complete.

The OS performs the race-free allocation by binding port `0`; OpenDucktor reads the actual bound ports from Vite and Bun instead of probing and releasing a port first.

### Phase 2: optional Portless front door — not needed for parallel execution

After native isolation works, add a thin, optional integration that registers the selected frontend port under a worktree-aware name. Prefer an alias or explicit registration after OpenDucktor binds the reserved port; do not ask Portless to infer ports inside `bun run scripts/dev.ts`.

Browser traffic should use one same-origin layout if Portless provides HTTPS: the named origin must proxy both the frontend and backend API/SSE paths, or OpenDucktor must make an explicit CORS and session-cookie contract change. Proxying only Vite while the browser calls a direct HTTP loopback backend will not work safely.

### Phase 3: optional external allocator

If users want machine-wide port blocks across many repositories, add a documented adapter recipe for Git Treeline or Worktrunk. OpenDucktor should consume explicit environment values and validate them; it should not depend on either tool for runtime identity, profile isolation, or MCP route safety.

## Risks and validation plan

- Start at least three browser worktrees at once and prove distinct frontend ports, backend ports, URLs, cookies, SSE streams, and cleanup after normal exit and forced termination.
- Start at least two Electron worktrees at once and prove distinct renderer ports, `userData`, `sessionData`, logs, runtime state, and MCP discovery records.
- For a Portless pilot, pin `0.15.5` and test cold Vite load, HMR over WebSocket and HTTP/2, simultaneous startup, Safari resolution, CA trust, and orphan cleanup.
- Test worktree identity collisions such as `feature/auth` and `bugfix/auth`, detached HEAD, long branch names, deleted worktrees, and a main checkout on a feature branch.
- Keep database and durable task-store schemas out of scope; this work should change development launch identity and transient discovery, not durable task records.

## Final conclusion

No reviewed tool replaces OpenDucktor's instance contract. The implemented solution uses OS-assigned ports plus worktree-derived identity, so Browser and Electron can run in parallel with no Portless, proxy, port registry, or manual port choice.

Portless remains a separate product choice for stable browser names. It does not belong in the core parallel-server solution.
