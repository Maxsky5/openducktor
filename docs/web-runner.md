# OpenDucktor web runner

The web runner opens OpenDucktor in a browser. It uses the same React frontend and TypeScript host contract as the Electron app.
The web runner needs Node.js 24.14 or later. It uses `node-pty` to run terminals.

## Start the runner

Use the published package with Node.js. This command does not need Bun:

```sh
npx @openducktor/web
```

Use Bun for repository development and workspace commands:

```sh
bun run browser:dev
```

Both commands start a loopback-only host and serve the shared frontend. The launcher binds both servers to `127.0.0.1`, and the browser config uses that loopback URL. See [the remote host protocol](remote-host-protocol.md) for Electron and web remote enablement, QR discovery, mobile contracts, proxy setup, and recovery.

Select Settings, Remote control to let clients reach this host. Use the host icon at the bottom of the workspace rail, left of Settings, to choose the host this client uses. Sharing starts disabled and changes take effect without a restart.

## Test a standalone client

```sh
bun run browser:client
```

This command serves only the frontend at `http://127.0.0.1:1421`. It starts with no selected host on the first visit and restores the host saved in this browser on later visits. It does not start a host process or fetch runtime configuration. It uses a separate Vite cache so it can run beside `bun run browser:dev`. The fixed frontend address keeps the same local storage across restarts.

Keep the host runner open in a second terminal. In that app, enable Settings, Remote control and copy the host address. Paste the address into the standalone client's connection screen. A direct address looks like `http://192.168.1.9:14328`, with no path suffix.

## Deploy a standalone web client

Build the browser client without a launcher or host:

```sh
bun run --filter @openducktor/web build:client
```

Deploy `packages/openducktor-web/dist/client` to a static HTTPS site. This build loads without `/openducktor-config.json`, an app token, or a local host. It shows the connection page on the first visit and remembers the chosen host in local storage. The connection page uses the same theme choices as onboarding and saves its theme in this browser.

On the host computer, enable Remote control and copy its host address. Open the static client on the other device and paste that address. The browser connects directly to the host; the static site does not forward host work. The default host address has no path suffix. A proxy can use an explicit path prefix.

An HTTPS client needs an HTTPS host address that its device can reach. `https://app.openducktor.dev` is allowed by default. For another static site, add its origin in the host's Advanced, Other web app URLs field.

The build produces deployment files. It does not deploy a public site or set up TLS for a host.

## Serve the runner on another machine

The runner can serve browsers on the network, for example from a VPS on a Tailscale tailnet. The launcher then uses remote browser configuration with a negotiated work endpoint. It also prints a private loopback operator URL for the same host.
The launcher rejects a non-loopback HTTP browser origin before it starts services, with an error that explains the HTTPS requirement.

Network browsers need HTTPS, including on a Tailscale tailnet. Plain HTTP at a non-loopback address does not provide the browser APIs that OpenDucktor needs at startup. Use the [same-origin HTTPS proxy setup](#serve-both-apps-under-one-origin) below.

The `--host` value is the bind address for the network frontend and remote work listener. The private local backend stays on loopback. The `--external-url` value is the origin browsers use to reach the frontend. The host URL derives from the same host and the backend port.

Restrict access before you start the runner:

- Keep the HTTP listeners on `127.0.0.1` when an HTTPS proxy forwards requests to them.
- Or allow only the Tailscale subnet in the firewall, for example `ufw allow from 100.64.0.0/10`.
- Keep the runner off the public internet. Anyone who can reach the remote work listener can negotiate full host work access.

The production static frontend and the backend accept only requests whose `Host` header is a loopback host, the bind host, or the `--external-url` host. Requests with any other `Host` header get a `403` response. This check protects against DNS rebinding.

The workspace frontend uses Vite's Host checks instead. Vite allows all IP literals, `localhost`, and `.localhost` subdomains by default, plus the configured bind and external hostnames. Host checks do not authenticate clients. Restrict network and proxy access in both modes.

Automatic browser hostname alignment supports only `localhost`, `127.0.0.1`, and `::1`. To use another loopback hostname, such as `runner.localhost`, configure that browser origin with `--external-url` and open that URL. Vite accepting a hostname does not grant backend access.

The launcher fails fast when it binds a non-loopback host without `--external-url`. Browsers on another machine cannot reach a loopback backend URL.

## Serve both apps under one origin

A reverse proxy can expose the frontend and the host on the same origin and port. The runner then needs no CORS and no second port. Use `--base-path` to mount the host under a path:

```sh
npx @openducktor/web --host 127.0.0.1 --external-url https://machine.ts.net --base-path /api
```

The network browser config uses `https://machine.ts.net/api` as the work endpoint. Forward only that namespace to the remote listener. The listener accepts the complete configured prefix or a prefix stripped to `/`:

- Tailscale Serve keeps the prefix: `tailscale serve --bg --set-path /api http://127.0.0.1:14327`
- Caddy can retain it with an exact-and-child path matcher: `@remote path /api /api/*`, then `handle @remote { reverse_proxy 127.0.0.1:14327 }`.
- nginx can strip it with both `location = /api { proxy_pass http://127.0.0.1:14327/; }` and `location /api/ { proxy_pass http://127.0.0.1:14327/; }`.

The first `--base-path` segment must not match a backend route namespace: `health`, `session`, `shutdown`, `events`, `local-attachment-preview`, `invoke`, `task-events`, `task-assets`, or `terminal`. This restriction also applies to nested paths, such as `/invoke/custom`. Use `/api`, `/api/v1`, or another nonconflicting path so that unprefixed routes remain reachable.

The example mounts the host at port 443, which differs from the frontend port 1420. The launcher logs an info message about this port mismatch. It is expected behind a proxy.

The frontend stays at the origin root, for example `tailscale serve --bg http://127.0.0.1:1420`. A same-origin deployment also gives the session cookie the `Secure` flag when the origin uses `https`.

The runner serves HTTP behind the proxy. Set `--external-url` to the HTTPS origin that browsers open. Tailscale encryption alone does not make a plain HTTP page a browser secure context.

Without `--base-path`, the browser reaches the host on the backend port, so the proxy must terminate TLS for that port too. The launcher logs an info message with the exact host URL when this case applies.

## Architecture

- `packages/frontend` owns the React app, `bootstrapOpenDucktorShell`, and `ShellBridge` types.
- `apps/electron` implements the bridge with preload IPC and delegates host work to `@openducktor/host`.
- `packages/openducktor-web` implements the bridge with HTTP calls and SSE subscriptions.
- `packages/openducktor-web/src/typescript-host-backend.ts` owns its host and private browser backend.
- `packages/remote-host` attaches the shared network work interface to either shell.

Shared frontend code cannot import shell internals. `bun run frontend:boundary-guard` checks this rule.

The `/events` endpoint authenticates the host session and streams the shared event bus for all repositories. Repository names select browser listeners; they do not restrict access. The transport does not support sessions authorized for only one repository.

The `/events` endpoint keeps one SSE connection and one replay cursor for non-task host events. Run, runtime, and Workspace Session events use the `message` event name. Live-session events use `agent-session-live:` followed by the JSON-encoded repository path. The browser registers a named listener for each observed repository and validates each delivered envelope. Events for unobserved repositories still cross the connection and advance its cursor, but do not trigger JSON parsing or transcript validation in JavaScript. The cursor contains the host epoch, so a cursor from an earlier host process cannot replay. The host keeps a bounded replay buffer for each SSE event name, so a busy repository cannot evict the events of another one. A total byte limit for all buffers evicts the oldest events first. Each connection ends its replay with a `replay-complete` event that names the event names with evicted events and reports a host change. A complete replay keeps the live-session collections and the Workspace Session lists. Listeners of an affected event name read their state again. Restart the host and reload the browser together when this event framing changes.

## Access control

The private local browser backend retains two tokens for each run. These tokens do not admit remote work:

- The control token authorizes launcher calls such as `/shutdown`. The launcher sends it in `x-openducktor-control-token`.
- The app token starts a browser session. The browser sends it once to `/session` in `x-openducktor-app-token`.

The host then sets the HttpOnly `openducktor_web_session` cookie for SSE and attachment previews. Invoke requests keep the app-token header and credentials. Tokens do not appear in URLs.

The session cookie is `HttpOnly; SameSite=Strict`. The host adds the `Secure` flag when the frontend origin uses `https`, so TLS deployments get a secure cookie without extra configuration. Plain HTTP browser use is limited to loopback origins.

The host CORS allowlist includes the configured frontend origin, its hostname without a trailing dot, and loopback origins at the frontend listening port. Browser requests from other origins get a `403`. CORS permission does not make cross-site session cookies work. With a remote or HTTPS `--external-url`, open that URL, not a direct HTTP frontend URL. The launcher displays only the configured external URL in these modes, including HTTPS loopback origins. Use the configured hostname consistently; accepting both dotted and undotted origins does not make their cookies interchangeable. The terminal WebSocket checks the origin, the session cookie, and the WebSocket subprotocol. The `/shutdown` route requires the launcher control token, which the browser never receives.

The launcher serves the browser config through `/openducktor-config.json` without authentication. Local mode includes its automatic app token. Network mode includes only the negotiated work endpoint. Restrict access as described in [Serve the runner on another machine](#serve-the-runner-on-another-machine).

Workspace mode serves the frontend with the Vite dev server. The dev server exposes its module graph and `fs.allow` paths, so use production mode (`npx @openducktor/web` without `--workspace`) on a remote machine. The launcher restricts Vite `fs.allow` to the web package, the frontend sources, and the workspace `node_modules` directory, and allows the external URL hostname when it is not an IP address.

The local browser shell requires a backend URL and automatic app token. The remote browser shell requires a complete remote work endpoint and negotiates compatibility. The launcher injects an explicit `local` or `remote` mode through `/openducktor-config.json`. Neither mode switches paths when connection fails. The host accepts a configured `http` or `https` origin without user info, path, query, or fragment. The port is optional. The web host does not fall back to a desktop runtime route.

## Package

The published `@openducktor/web` package contains:

- `dist/cli.js` for the launcher and TypeScript host.
- Shared `dist/*.js` chunks, `dist/generated-image-worker.js`, and `dist/openducktor-mcp.js`.
- `dist/drizzle/**` for the SQLite task-store migration files.
- `dist/web-shell/**` for the built browser UI.
- `dist/client/**` for the standalone static browser client.

The package retains native runtime dependencies and bundles the host's JavaScript dependencies.
See [build and packaging](build-and-packaging.md) for the dependency rules and size measurements.

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
