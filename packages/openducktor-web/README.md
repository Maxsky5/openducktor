# @openducktor/web

Local browser runner for OpenDucktor.

```sh
npx @openducktor/web
```

The runner needs Node.js 24.14 or later. It uses Node and `node-pty` for the host and terminal processes. The CLI starts the host on `127.0.0.1`, waits for readiness, serves the bundled frontend, and shuts the host down when the process exits. The browser shell receives an app token and opens an HttpOnly host session cookie through `/session`.

## Development

From the OpenDucktor repository root:

```sh
bun run browser:dev
```

Workspace mode runs the Node host in-process and serves the frontend with Vite. The development script builds the Node CLI and MCP helper before it starts them. Published installs use bundled static frontend assets and the Node host in `dist/cli.js`.

Workspace mode lets the OS assign frontend and backend ports, prints both resolved URLs, and publishes external MCP discovery to `runtime/dev-instances/<instanceId>/mcp-bridge.json`. Published installs keep fixed default ports and use `runtime/mcp-bridge.json`. For automatic development discovery, external MCP clients must set `OPENDUCKTOR_CHANNEL=dev` and the printed `OPENDUCKTOR_DEV_INSTANCE` value. Clients can instead use `ODT_HOST_URL` or `--host-url`.

## Options

```sh
npx @openducktor/web --port 1420 --backend-port 14327
```

- `--port`: frontend server port; `0` lets the OS assign it
- `--backend-port`: local TypeScript host port; `0` lets the OS assign it

## Release contents

The npm package must include:

- `dist/cli.js`
- `dist/openducktor-mcp.js`
- `dist/web-shell/**`

The release workflow builds the CLI and web shell, verifies package contents, dry-runs npm packaging, and publishes `@openducktor/web` with its Node runtime dependencies.
