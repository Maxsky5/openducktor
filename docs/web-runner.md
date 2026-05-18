# OpenDucktor Web Runner

The web runner lets OpenDucktor run in a browser without a desktop window. It uses the same shared React frontend as the desktop shells and the same TypeScript host boundary as the Electron shell.

## Command

```sh
bunx @openducktor/web
```

During repository development, use the root wrapper:

```sh
bun run browser:dev
```

Both commands start a loopback-only TypeScript host backend and serve the shared frontend.

## Architecture

- `packages/frontend` owns the shared React app and shell bootstrap. It exposes `bootstrapOpenDucktorShell` and the `ShellBridge` contract types.
- `apps/desktop/src` is a thin Tauri shell that implements the bridge with Tauri invoke/events.
- `apps/electron` is a thin Electron shell that implements the bridge with Electron IPC/preload and delegates host behavior to `@openducktor/host`.
- `packages/openducktor-web` is a browser shell and launcher. It implements the bridge with HTTP invoke calls and SSE subscriptions against the local TypeScript host backend.
- `packages/openducktor-web/src/typescript-host-backend.ts` adapts `@openducktor/host` to the browser HTTP/SSE contract.

Shared frontend code must not import `@tauri-apps/api`, `apps/desktop`, or `src-tauri`. The root `bun run frontend:boundary-guard` check enforces that boundary.

## Control Plane

The launcher generates two tokens for each run and passes both to the TypeScript host backend:

- a control token for launcher-only operations such as `/shutdown`, sent with the `x-openducktor-control-token` header;
- an app token for browser-facing API bootstrap. The browser shell sends it once to `/session` with the `x-openducktor-app-token` header. The host then sets an HttpOnly `openducktor_web_session` cookie for SSE streams and attachment previews, so app tokens are not placed in URLs. Invoke requests still include the app-token header and credentials.

The browser shell fails fast if the launcher does not inject `VITE_ODT_BROWSER_BACKEND_URL` and `VITE_ODT_BROWSER_AUTH_TOKEN`. There is no default backend URL, so a page cannot accidentally attach to a stale local host.

The web host validates the configured frontend origin for CORS. The origin must be an `http` loopback origin with an explicit port and no credentials, path, query, or fragment. There is no fallback from the web host to a desktop runtime route.

## Release Packaging

Published installs are self-contained in the `@openducktor/web` package:

- `dist/cli.js` contains the launcher and TypeScript host backend.
- `dist/web-shell/**` contains the built browser shell.

Release automation owns the package in `.github/workflows/publish-web.yml`. The workflow builds `@openducktor/web`, verifies package contents with `scripts/prepare-web-publish-packages.ts`, runs `npm publish --dry-run`, and publishes the package through npm Trusted Publisher.

Workspace development mode (`bun run browser:dev`) runs the same launcher in `--workspace` mode. It starts the TypeScript host backend in-process and serves the repo-local frontend with Vite.

The published package and workspace mode both fail fast if runtime config is missing, if the launcher cannot establish a session with the app token, or if a host command is unavailable.

The web runner is currently intended for local development and local browser use. Platform behavior follows the TypeScript host and local runtime discovery behavior rather than the legacy Rust web-host binary path.

## Verification

Relevant checks for web-runner changes:

```sh
bun run frontend:boundary-guard
(cd packages/openducktor-web && bunx vite build --outDir /tmp/openducktor-web-vite-build --emptyOutDir)
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/web test
bun run --filter @openducktor/web typecheck
bun run --filter @openducktor/web build
```

Full release confidence also requires the root repo checks (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`) and a browser smoke against the live `bun run browser:dev` app. Desktop changes should be smoke-tested with the relevant desktop shell (`bun run electron:dev`, `bun run tauri:dev`, or a packaged desktop artifact) before publishing the draft release.
