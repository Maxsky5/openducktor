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

## Response compression and asset caching

The Node HTTP server streams eligible text responses of at least 1 KiB through gzip when the client accepts it. This includes application assets and host JSON responses. It uses the declared content length when present. Otherwise, it reads only enough bytes to choose gzip or send the complete small body without compression. Responses retain their content type and status. `Vary: Accept-Encoding` keeps compressed and uncompressed cache entries separate. Compressed responses use weak ETags because compression changes the bytes.

Live event streams, binary files, responses that already have a content encoding, partial responses, and responses with `Cache-Control: no-transform` bypass compression. Clients that do not advertise gzip support receive uncompressed content.

Published installs serve Vite assets with content hashes in their names with `Cache-Control: public, max-age=31536000, immutable`. HTML and other application files require revalidation with an ETag. Unchanged files return `304` without a body. A new build changes the HTML validator and the URLs of changed hashed assets.

Runtime configuration keeps `Cache-Control: no-store` and has no ETag. Each request reads the current backend URL and app token.

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
