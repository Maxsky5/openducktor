# OpenDucktor web runner

The web runner opens OpenDucktor in a browser. It uses the same React frontend and TypeScript host contract as the Electron app.

## Start the runner

Use the published package:

```sh
bunx @openducktor/web
```

Use this command while you work in the repository:

```sh
bun run browser:dev
```

Both commands start a loopback-only host and serve the shared frontend.

## Architecture

- `packages/frontend` owns the React app, `bootstrapOpenDucktorShell`, and `ShellBridge` types.
- `apps/electron` implements the bridge with preload IPC and delegates host work to `@openducktor/host`.
- `packages/openducktor-web` implements the bridge with HTTP calls and SSE subscriptions.
- `packages/openducktor-web/src/typescript-host-backend.ts` maps `@openducktor/host` to the HTTP and SSE contract.

Shared frontend code cannot import shell internals. `bun run frontend:boundary-guard` checks this rule.

## Access control

The launcher creates two tokens for each run:

- The control token authorizes launcher calls such as `/shutdown`. The launcher sends it in `x-openducktor-control-token`.
- The app token starts a browser session. The browser sends it once to `/session` in `x-openducktor-app-token`.

The host then sets the HttpOnly `openducktor_web_session` cookie for SSE and attachment previews. Invoke requests keep the app-token header and credentials. Tokens do not appear in URLs.

The browser shell requires `VITE_ODT_BROWSER_BACKEND_URL` and `VITE_ODT_BROWSER_AUTH_TOKEN`. It does not use a default URL. The host accepts only a configured `http` loopback origin with an explicit port and no user info, path, query, or fragment. The web host does not fall back to a desktop runtime route.

## Package

The published `@openducktor/web` package contains:

- `dist/cli.js` for the launcher and TypeScript host.
- `dist/web-shell/**` for the built browser UI.

`.github/workflows/publish-web.yml` builds and checks the package. It runs `scripts/prepare-web-publish-packages.ts` and `npm publish --dry-run`, then publishes through npm Trusted Publisher.

`bun run browser:dev` runs the same launcher in workspace mode and serves the local frontend with Vite. Both modes stop with an error when config, session setup, or a host command fails.

The web runner supports local browser use. Its platform behavior follows the TypeScript host and local runtime discovery.

## Verify a change

```sh
bun run frontend:boundary-guard
(cd packages/openducktor-web && bunx vite build --outDir /tmp/openducktor-web-vite-build --emptyOutDir)
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/web test
bun run --filter @openducktor/web typecheck
bun run --filter @openducktor/web build
```

Before a release, also run the root lint, typecheck, test, and build. Test the live browser app. Test desktop changes with `bun run electron:dev` or a packaged app before you publish the draft.
