# @openducktor/web

Local browser runner for OpenDucktor.

```sh
bunx @openducktor/web
```

The CLI starts the OpenDucktor TypeScript web host on `127.0.0.1`, waits for readiness, serves the bundled OpenDucktor frontend, and shuts the host down with a control-token-protected request when the process exits. The browser shell receives a launcher-generated app token, opens an HttpOnly host session cookie through `/session`, and fails fast if the launcher does not inject the local host URL or token.

## Development

From the OpenDucktor repository root:

```sh
bun run browser:dev
```

That workspace mode runs the TypeScript host in-process and serves the frontend with Vite. Published installs use bundled static frontend assets plus the TypeScript host bundled into `dist/cli.js`.

Workspace mode lets the OS assign frontend and backend ports, prints both resolved URLs, and publishes external MCP discovery to `runtime/dev-instances/<instanceId>/mcp-bridge.json`. Published installs keep fixed default ports and use `runtime/mcp-bridge.json`. For automatic development discovery, external MCP clients must set `OPENDUCKTOR_CHANNEL=dev` and the printed `OPENDUCKTOR_DEV_INSTANCE` value. Clients can instead use `ODT_HOST_URL` or `--host-url`.

## Options

```sh
bunx @openducktor/web --port 1420 --backend-port 14327
```

- `--port`: frontend server port; `0` lets the OS assign it
- `--backend-port`: local TypeScript host port; `0` lets the OS assign it

## Release contents

The npm package must include:

- `dist/cli.js`
- `dist/web-shell/**`

The release workflow builds the CLI and web shell, verifies package contents, dry-runs npm packaging, and publishes the single self-contained `@openducktor/web` package.
