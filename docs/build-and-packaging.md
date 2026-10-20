# Build and packaging

Electron and the web runner bundle the shared frontend and host from workspace source. Use `bun run build` for the full workspace build and `bun run electron:package` for the local desktop package.

## Build outputs

| Package | Output | Builder |
| --- | --- | --- |
| Electron | Main process, preload, image worker | Bun, Node target |
| Electron | Renderer | Vite |
| Electron | Standalone MCP sidecar | Bun, compiled executable |
| Web runner | CLI, image worker, shared chunks | Bun, Node target |
| Web runner | Browser UI | Vite |
| Web runner | MCP entrypoint | Bun, Node target |
| MCP package | JavaScript entrypoint | Bun, Bun target |

The Bun builds use `--minify --keep-names` to reduce output size and keep function and class names for errors and logs. See [Bun minification](https://bun.com/docs/bundler/minifier).

The web CLI build shares code between the CLI and image worker through `--splitting`. Shared chunks stay beside the entrypoints in `dist`, so code that uses `import.meta.url` keeps the same directory. Publish the full `dist` directory, including those chunks, the image worker, MCP entrypoint, browser assets, and SQLite migration files.


Both Vite builds set `reportCompressedSize: false` to skip gzip work that only produces size reports. This option does not change the generated assets or package compression. See [Vite compressed size reports](https://vite.dev/config/build-options.html#build-reportcompressedsize).

## Runtime dependencies

| Dependency | Distribution rule |
| --- | --- |
| `@azure/msal-node-extensions` | External; retain its native persistence dependencies. |
| `@ff-labs/fff-node` | External; retain the binary for the package platform. |
| `node-pty` | External; retain its native terminal dependencies. |
| `node-mac-permissions` | Retain the optional Electron dependency on macOS. |
| Bundled JavaScript libraries | Declare them as build dependencies in the shell package. |

Electron bundles `electron-updater`, `semver`, and `yaml`. The web runner bundles `mime-types`, `undici`, `ws`, and `zod`. These libraries do not need a second copy in the installed package. Electron Builder reads the entrypoint and dependency metadata from `apps/electron/package.json`.

The host owns the Claude Agent SDK dependency, and both host bundles include its JavaScript. The host supplies the selected external Claude executable through `pathToClaudeCodeExecutable`. The web package therefore does not install another SDK copy and its optional Claude binaries. The external Claude installation remains required as described in the [runtime integration guide](runtime-integration-guide.md).

## Measurements

These measurements cover task `openduckto-hauuo` on 2026-10-12, with base commit `edf889c86f3b1fec735858968e5182a102015141`. The machine ran macOS arm64, Bun `1.4.2`, and Node `24.14.0`. The table uses decimal MB, where one MB is 1,000,000 bytes.

| Output | Before | After | Reduction |
| --- | --- | --- | --- |
| Electron `dist` | 32.05 MB | 28.38 MB | 11.4% |
| Web `dist` | 34.59 MB | 29.12 MB | 15.8% |
| Electron `app.asar` | 38.86 MB | 32.41 MB | 16.6% |
| Electron app | 416.00 MB | 409.00 MB | 1.7% |
| Electron DMG | 165.92 MB | 164.89 MB | 0.6% |
| Web tarball | 9.82 MB | 8.63 MB | 12.1% |
| Web production install files | 385.61 MB | 116.47 MB | 69.8% |

The install comparison used isolated directories and `bun install --production --ignore-scripts` for each local tarball. It counts regular files below `node_modules`, without following directory links. It measures package contents before native installation scripts run. It does not prove a fresh native installation.

The web build took 3.16 seconds before and 2.04 seconds after in one local comparison. The Electron build took 1.48 seconds before and 1.55 seconds after. Electron packaging took 24.45 seconds before and 25.54 seconds after, including binary download and signing work. These single runs do not show an Electron build or packaging speed gain.

The change also removes the private `BrowserTabs` and `TaskSelector` modules, their tests, and the browser-tabs guide. Their only callers were their own tests, and neither module was part of the frontend package exports. Three symbols that only have callers in their own files are now private.

## Verification

Run the five full repository checks from [Contributing](../CONTRIBUTING.md#verification-commands). Also run the dependency gate from [Dependency hygiene](dependency-hygiene.md).

Check the image worker bundles under Node, Bun, and Electron:

```sh
bun run test:workers
```

Before a web release, build the package and check its required files:

```sh
bun run --filter @openducktor/web build
bun run scripts/prepare-web-publish-packages.ts 1.0.0-beta.2
```

Use the actual release version for the second command. Pack the web workspace with `bun pm pack --ignore-scripts`, install that tarball in an isolated directory, and verify its Node CLI and MCP startup. The isolated package must work without workspace source or workspace dependencies.

The local macOS arm64 package check verifies the compiled MCP sidecar and native file search after packaging. The image-worker check covers the minified worker code and the shared web chunks under Node. Windows, Linux, notarization, live agent sessions, and visual browser behavior still need their own platform or runtime checks.

## Remaining costs

The shared frontend still includes syntax grammars for the supported file viewers, Mermaid diagram modules, and editor extensions. Removing those assets would need a separate decision about supported content. The desktop app also includes the Electron framework and a Bun runtime in its standalone MCP sidecar. Replacing the sidecar runtime would change its launch, signing, and platform contracts.
