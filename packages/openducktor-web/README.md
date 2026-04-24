# @openducktor/web

Local browser runner for OpenDucktor.

```sh
bunx @openducktor/web
```

The CLI starts the OpenDucktor Rust web host on `127.0.0.1`, waits for readiness, serves the shared React frontend with Vite, and shuts the host down with a control-token-protected request when the process exits.

## Development

From the OpenDucktor repository root:

```sh
bun run browser:dev
```

That workspace mode runs the Rust host through Cargo. Published installs use a packaged macOS host binary plus a `.sha256` checksum file. Missing or mismatched packaged artifacts fail startup before any fallback is attempted.

## Options

```sh
bunx @openducktor/web --port 1420 --backend-port 14327
```

- `--port`: frontend Vite server port
- `--backend-port`: local Rust host port
- `--host-binary`: explicit host binary path for local testing

OpenDucktor is macOS-first; packaged web-host binaries currently support Apple Silicon and Intel macOS.

## Release contents

The npm package must include:

- `bin/openducktor-web-host-darwin-arm64`
- `bin/openducktor-web-host-darwin-arm64.sha256`
- `bin/openducktor-web-host-darwin-x64`
- `bin/openducktor-web-host-darwin-x64.sha256`

The release workflow builds those binaries, verifies checksums, dry-runs npm packaging, and publishes the shared OpenDucktor runtime packages before publishing `@openducktor/web`.
