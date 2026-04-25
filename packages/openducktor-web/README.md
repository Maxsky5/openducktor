# @openducktor/web

Local browser runner for OpenDucktor.

```sh
bunx @openducktor/web
```

The CLI starts the OpenDucktor Rust web host on `127.0.0.1`, waits for readiness, serves the bundled OpenDucktor frontend, and shuts the host down with a control-token-protected request when the process exits. The browser shell receives a launcher-generated app token, opens an HttpOnly host session cookie through `/session`, and fails fast if the launcher does not inject the local host URL or token.

## Development

From the OpenDucktor repository root:

```sh
bun run browser:dev
```

That workspace mode runs the Rust host through Cargo and serves the frontend with Vite. Published installs use bundled static frontend assets plus a packaged macOS host binary and `.sha256` checksum file. Missing or mismatched packaged artifacts fail startup before any fallback is attempted.

## Options

```sh
bunx @openducktor/web --port 1420 --backend-port 14327
```

- `--port`: frontend server port
- `--backend-port`: local Rust host port
- `--host-binary`: explicit host binary path for local testing

OpenDucktor is macOS-first; packaged web-host binaries currently support Apple Silicon and Intel macOS.

## Release contents

The npm package must include:

- `bin/openducktor-web-host-darwin-arm64`
- `bin/openducktor-web-host-darwin-arm64.sha256`
- `bin/openducktor-web-host-darwin-x64`
- `bin/openducktor-web-host-darwin-x64.sha256`
- `dist/cli.js`
- `dist/web-shell/**`

The release workflow builds those binaries, verifies checksums and package contents, dry-runs npm packaging, and publishes the single self-contained `@openducktor/web` package.
