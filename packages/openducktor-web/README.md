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

Workspace mode publishes external MCP discovery to `runtime/mcp-bridge-dev.json`. Published installs use the production `runtime/mcp-bridge.json` descriptor. External MCP clients must set `OPENDUCKTOR_CHANNEL=dev` to connect to workspace mode.

## Options

```sh
bunx @openducktor/web --port 1420 --backend-port 14327
```

- `--port`: frontend server port
- `--backend-port`: local TypeScript host port

## Release contents

The npm package must include:

- `dist/cli.js`
- `dist/web-shell/**`

The release workflow builds the CLI and web shell, verifies package contents, dry-runs npm packaging, and publishes the single self-contained `@openducktor/web` package.
