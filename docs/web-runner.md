# OpenDucktor Web Runner

The web runner lets OpenDucktor run in a browser without a Tauri window while preserving the desktop app. It is a regular supported way to run OpenDucktor locally.

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

The launcher generates two tokens for each run and passes both to the Rust web host:

- a control token for launcher-only operations such as `/shutdown`, sent with the `x-openducktor-control-token` header;
- an app token for browser-facing API bootstrap. The browser shell sends it once to `/session` with the `x-openducktor-app-token` header. The host then sets an HttpOnly `openducktor_web_session` cookie for SSE streams and attachment previews, so app tokens are not placed in URLs. Invoke requests still include the app-token header and credentials.

The browser shell fails fast if the launcher does not inject `VITE_ODT_BROWSER_BACKEND_URL` and `VITE_ODT_BROWSER_AUTH_TOKEN`. There is no default backend URL, so a page cannot accidentally attach to a stale local host.

The web host validates the configured frontend origin for CORS. The origin must be an `http` loopback origin with an explicit port and no credentials, path, query, or fragment. There is no fallback from the web host to a desktop runtime route.

The desktop binary also accepts a strict internal `--web-host` mode for bridge processes. The older `--browser-backend` flag remains as a compatibility alias, but new callers should use `--web-host`.

## Release Packaging

Published installs resolve a platform-specific host binary from `packages/openducktor-web/bin/`:

- `openducktor-web-host-darwin-arm64`
- `openducktor-web-host-darwin-x64`

Each binary must have a sibling `.sha256` file. The launcher fails before startup if the current platform is unsupported, the binary is missing, or the checksum does not match.

Release automation owns those artifacts in `.github/workflows/publish-web.yml`. The workflow builds `openducktor-web-host` for both macOS targets, passes the binaries to the publish job as GitHub Actions artifacts, copies them into `packages/openducktor-web/bin/`, verifies package contents and checksums, runs `npm publish --dry-run`, and publishes the single self-contained `@openducktor/web` package.

Workspace development mode (`bun run browser:dev`) resolves the host through Cargo instead:

```sh
cargo run --bin openducktor-web-host -- --port <port> --frontend-origin <origin> --control-token <token> --app-token <token>
```

## Verification

Relevant checks for web-runner changes:

```sh
bun run frontend:boundary-guard
(cd packages/openducktor-web && bunx vite build --outDir /tmp/openducktor-web-vite-build --emptyOutDir)
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/web test
bun run --filter @openducktor/web typecheck
bun run --filter @openducktor/web build
cd apps/desktop/src-tauri && cargo test --bin openducktor-web-host
```

Full release confidence also requires the root repo checks (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run check:rust`, `bun run test:rust`) and a browser smoke against the live `bun run browser:dev` app. Desktop changes should be smoke-tested with `bun run tauri:dev` or the packaged desktop artifact before publishing the draft release.
