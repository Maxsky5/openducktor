# OpenDucktor Web Runner

The web runner lets OpenDucktor run without a Tauri window while preserving the desktop app. It is intended for local browser use, browser automation, and agent-driven UI validation.

## Command

```sh
bunx @openducktor/web
```

During repository development, use the root wrapper:

```sh
bun run browser:dev
```

Both commands start a loopback-only Rust host and serve the shared frontend with Vite.

## Architecture

- `packages/frontend` owns the shared React app. It exposes `mountOpenDucktorApp` and the `ShellBridge` contract.
- `apps/desktop/src` is a thin Tauri shell that implements the bridge with Tauri invoke/events.
- `packages/openducktor-web` is a thin browser shell and launcher. It implements the bridge with HTTP invoke calls and SSE subscriptions against the local Rust host.
- `openducktor-web-host` is a dedicated Rust binary under `apps/desktop/src-tauri/src/bin/`.

Shared frontend code must not import `@tauri-apps/api`, `apps/desktop`, or `src-tauri`. The root `bun run frontend:boundary-guard` check enforces that boundary.

## Control Plane

The launcher generates a control token for each run and passes it to the Rust web host. The web shell uses the host only through the configured loopback URL. The shutdown endpoint requires the `x-openducktor-control-token` header so random local pages cannot stop the host.

The web host validates the configured frontend origin for CORS. There is no fallback from the web host to a desktop runtime route.

## Release Packaging

Published installs resolve a platform-specific host binary from `packages/openducktor-web/bin/`:

- `openducktor-web-host-darwin-arm64`
- `openducktor-web-host-darwin-x64`

Each binary must have a sibling `.sha256` file. The launcher fails before startup if the current platform is unsupported, the binary is missing, or the checksum does not match.

Workspace development mode (`bun run browser:dev`) resolves the host through Cargo instead:

```sh
cargo run --bin openducktor-web-host -- --port <port> --frontend-origin <origin> --control-token <token>
```

## Verification

Relevant checks for web-runner changes:

```sh
bun run frontend:boundary-guard
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/web test
bun run --filter @openducktor/web typecheck
cd apps/desktop/src-tauri && cargo test --bin openducktor-web-host
```
