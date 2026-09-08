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

Both commands start a loopback-only host and serve the shared frontend. The launcher binds both servers to `127.0.0.1`, and the browser config uses that loopback URL.

## Serve the runner on another machine

The runner can serve browsers on the network, for example from a VPS on a Tailscale tailnet. The launcher then uses the network URL in the browser config instead of the loopback URL, and the host accepts the network origin.

Start the runner with a bind host and an external URL:

```sh
bunx @openducktor/web --host 0.0.0.0 --external-url http://100.64.0.1:1420
```

The `--host` value is the bind address for the frontend and the host. The `--external-url` value is the origin browsers use to reach the frontend. The host URL derives from the same host and the backend port.

Restrict access before you start the runner:

- Bind to the Tailscale IP instead of `0.0.0.0` when the machine has one.
- Or allow only the Tailscale subnet in the firewall, for example `ufw allow from 100.64.0.0/10`.
- Keep the runner off the public internet. The app token is part of the served browser config, so anyone who can reach the ports can use the runner.

The production static frontend and the backend accept only requests whose `Host` header is a loopback host, the bind host, or the `--external-url` host. Requests with any other `Host` header get a `403` response. This check protects against DNS rebinding.

The workspace frontend uses Vite's Host checks instead. Vite allows all IP literals, `localhost`, and `.localhost` subdomains by default, plus the configured bind and external hostnames. Host checks do not authenticate clients. Restrict network and proxy access in both modes.

The launcher fails fast when it binds a non-loopback host without `--external-url`. Browsers on another machine cannot reach a loopback backend URL.

## Serve both apps under one origin

A reverse proxy can expose the frontend and the host on the same origin and port. The runner then needs no CORS and no second port. Use `--base-path` to mount the host under a path:

```sh
bunx @openducktor/web --host 127.0.0.1 --external-url https://machine.ts.net --base-path /api
```

The browser config uses `https://machine.ts.net/api` as the host URL. The host strips the `/api` prefix from its routes, so the proxy may keep or strip the prefix:

- Tailscale Serve keeps the prefix: `tailscale serve --bg --set-path /api http://127.0.0.1:14327`
- Caddy can strip it: `handle_path /api/* { reverse_proxy 127.0.0.1:14327 }`
- nginx can strip it with `location /api/ { proxy_pass http://127.0.0.1:14327/; }`

The example mounts the host at port 443, which differs from the frontend port 1420. The launcher logs an info message about this port mismatch. It is expected behind a proxy.

The frontend stays at the origin root, for example `tailscale serve --bg http://127.0.0.1:1420`. A same-origin deployment also gives the session cookie the `Secure` flag when the origin uses `https`.

The runner serves plain HTTP. Tailscale encrypts the traffic in transit, so this is safe on the tailnet. Use a TLS reverse proxy in front of the runner for a public deployment, and set `--external-url` to the `https` origin. The host then sets the `Secure` cookie flag automatically.

Without `--base-path`, the browser reaches the host on the backend port, so the proxy must terminate TLS for that port too. The launcher logs an info message with the exact host URL when this case applies.

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

The session cookie is `HttpOnly; SameSite=Strict`. The host adds the `Secure` flag when the frontend origin uses `https`, so TLS deployments get a secure cookie without extra configuration. Plain HTTP deployments stay on the tailnet, where Tailscale encrypts the traffic.

The host CORS allowlist includes the configured frontend origin, its hostname without a trailing dot, and loopback origins at the frontend listening port. Browser requests from other origins get a `403`. CORS permission does not make cross-site session cookies work. With a remote or HTTPS `--external-url`, open that URL, not a direct HTTP frontend URL. The launcher displays only the configured external URL in these modes, including HTTPS loopback origins. Use the configured hostname consistently; accepting both dotted and undotted origins does not make their cookies interchangeable. The terminal WebSocket checks the origin, the session cookie, and the WebSocket subprotocol. The `/shutdown` route requires the launcher control token, which the browser never receives.

The launcher serves the browser config through `/openducktor-config.json` without authentication. Anyone who can reach the frontend port can read the app token. Restrict access as described in [Serve the runner on another machine](#serve-the-runner-on-another-machine).

Workspace mode serves the frontend with the Vite dev server. The dev server exposes its module graph and `fs.allow` paths, so prefer production mode (`bunx @openducktor/web` without `--workspace`) on a remote machine. The launcher restricts Vite `fs.allow` to the web package and frontend sources, and allows the external URL hostname when it is not an IP address.

The browser shell requires `VITE_ODT_BROWSER_BACKEND_URL` and `VITE_ODT_BROWSER_AUTH_TOKEN`. It does not use a default URL. The launcher injects both through `/openducktor-config.json`. The host accepts a configured `http` or `https` origin without user info, path, query, or fragment. The port is optional. The web host does not fall back to a desktop runtime route.

## Package

The published `@openducktor/web` package contains:

- `dist/cli.js` for the launcher and TypeScript host.
- `dist/web-shell/**` for the built browser UI.

`.github/workflows/publish-web.yml` builds and checks the package. It runs `scripts/prepare-web-publish-packages.ts` and `npm publish --dry-run`, then publishes through npm Trusted Publisher.

`bun run browser:dev` runs the same launcher in workspace mode and serves the local frontend with Vite. Both modes stop with an error when config, session setup, or a host command fails.

The web runner supports local browser use and network use through `--host` and `--external-url`. Its platform behavior follows the TypeScript host and local runtime discovery.

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
