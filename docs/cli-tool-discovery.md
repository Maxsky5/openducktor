# CLI and tool discovery

OpenDucktor uses local Git, GitHub CLI, Bun, OpenCode, Codex, and Claude Code. The TypeScript host finds these tools for both Electron and web shells.

A consumer asks `ToolDiscoveryPort` for a tool. It does not search files, read `process.env`, run `which`, or inspect an app bundle.

```ts
const codexPath = yield* toolDiscovery.resolveToolPath("codex");
const githubCli = yield* toolDiscovery.resolveTool("githubCli");
```

`resolveToolPath` returns the executable path. `resolveTool` also returns the source data that diagnostics can show. Failure uses a typed host error with an install or settings action.

## Saved runtime paths

Global config version 3 stores `enabled` and `executablePath` for OpenCode, Codex, and Claude. A new install discovers each path once, saves valid paths, and enables each runtime it found.

The version 2 migration keeps the current enabled choice. It discovers paths once and saves an empty path for a missing runtime.

Startup, version checks, and diagnostics use the saved path. If that path is invalid, they tell the user to fix it in Settings. They do not try an environment variable, bundled path, common path, or `PATH`.

Onboarding and Settings call `runtime_executables_check`. The Check again action runs discovery and can replace saved paths. Normal startup does not repeat discovery.

## Ownership

| Concern | Owner |
|---|---|
| Tool IDs | `packages/host/src/ports/tool-discovery-port.ts` |
| User path syntax and home expansion | `packages/path-support/src/user-path.ts` |
| Descriptors and search order | `packages/host/src/adapters/system/tool-discovery.ts` |
| `PATH`, `PATHEXT`, and executable checks | `packages/host/src/infrastructure/process/process-command-resolution.ts` |
| Command path and version port | `packages/host/src/adapters/system/system-command-runner.ts` |
| Electron and web host setup | `packages/host/src/composition/node/node-host-default-ports.ts` |
| Runtime path setup and migration | `packages/host/src/application/runtimes/runtime-config-initializer.ts` |
| Saved path check | `packages/host/src/application/runtimes/runtime-executable-check-service.ts` |
| Distribution input | `packages/host/src/adapters/runtimes/runtime-distribution.ts` |
| Electron distribution | `apps/electron/src/main/electron-runtime-distribution.ts` |
| Web distribution | `packages/openducktor-web/src/web-runtime-distribution.ts` |

Use `@openducktor/path-support` to parse a user path. Supply home directory and path joining at the caller boundary.

## Host startup

`createNodeHostDefaultPorts` builds these values in order:

1. `processEnv` with platform environment rules.
2. `systemCommands` from that environment.
3. `toolDiscovery` from system commands, environment, shell paths, and distribution paths.
4. Adapters and services that use `toolDiscovery`.

Electron, the published web package, and web workspace mode use this setup.

## Search order

A descriptor lists only sources specific to its tool. The shared search adds explicit paths before those sources and `PATH` after them. The first valid executable wins.

### Environment variable

The tool's environment variable has first priority. It can contain an absolute path, a home-relative path such as `~/bin/tool`, or a command name that the command runner can resolve.

```text
OPENDUCKTOR_BUN_PATH=/opt/homebrew/bin/bun
```

An empty or invalid value returns `HostValidationError`. The search stops because the user set that value.

### Shell-provided path

A shell can pass a path in `providedToolPaths`, keyed by `ToolDiscoveryId`. The host checks it after the environment variable. An invalid provided path fails because the shell claimed that exact path for this run.

### Descriptor directories

A descriptor can list package-owned or common install directories such as `~/.opencode/bin`.

| Policy | Result when the directory is missing |
|---|---|
| `candidate` | Continue to the next source. |
| `required` | Return an error. |

Use `required` only when the current distribution promises that path.

### Descriptor files

A descriptor can list exact files that do not fit a directory search. Codex uses this for macOS app files:

```text
/Applications/Codex.app/Contents/Resources/codex
~/Applications/Codex.app/Contents/Resources/codex
```

### PATH

`PATH` is the last built-in source. `SystemCommandPort.resolveCommandPath` applies platform rules:

- POSIX accepts an executable regular file.
- POSIX startup puts the login shell `PATH` before inherited GUI entries.
- Windows uses `PATHEXT` and accepts executable types such as `.exe`, `.cmd`, and `.bat`.
- No platform accepts a directory as a command.

## Tool list

| ID | Command | Environment variable | Extra sources | Main use |
|---|---|---|---|---|
| `bun` | `bun` | `OPENDUCKTOR_BUN_PATH` | None | Run source or web MCP file |
| `codex` | `codex` | `OPENDUCKTOR_CODEX_BINARY` | Bundled directory and macOS app files | Setup and rediscovery |
| `claude` | `claude` | `OPENDUCKTOR_CLAUDE_BINARY` | None | Setup and rediscovery |
| `git` | `git` | `OPENDUCKTOR_GIT_PATH` | None | Git and diagnostics |
| `githubCli` | `gh` | `OPENDUCKTOR_GH_PATH` | None | GitHub auth and pull requests |
| `opencode` | `opencode` | `OPENDUCKTOR_OPENCODE_BINARY` | Bundled directory and `~/.opencode/bin` | Setup and rediscovery |

Keep the three released `*_BINARY` names. For a new general tool, use `OPENDUCKTOR_<TOOL>_PATH`.

## Distribution modes

### Source mode

Local development has the workspace root but no package-owned tool directories. Search the environment variable, shell path, descriptor paths, and `PATH`.

### Electron package

Electron passes an artifact distribution. It resolves the MCP launcher from app resources. The host provides SQLite task storage, so the package has no task-store CLI.

All package paths must come from the active app resources. Never use a development worktree path.

### Web package

`bunx @openducktor/web` passes an artifact distribution. It runs `dist/openducktor-mcp.js` with the Bun executable that started the web package.

The web package does not use Electron resources and has no bundled runtime CLI directory. It finds runtime CLIs through descriptor rules unless the shell supplies an exact path. A future bundled CLI must use an npm package path.

## Errors

| Case | Error | Reason |
|---|---|---|
| Explicit value is empty | `HostValidationError` | User config is invalid. |
| Explicit file is missing or not executable | `HostValidationError` | User config must change. |
| Required bundled source is missing | `HostDependencyError` | The package is incomplete. |
| All sources miss the tool | `HostDependencyError` | The host dependency is absent. |

A missing-tool error lists every checked source and the install hint.

```text
bun not found. Checked OPENDUCKTOR_BUN_PATH, PATH. Install bun and ensure it is available on PATH, or set OPENDUCKTOR_BUN_PATH.
```

## Add a CLI

### 1. Check ownership

Use `ToolDiscoveryPort` for a known dependency of a host service, runtime, diagnostic, GitHub flow, MCP launcher, or other host workflow. Keep user-defined commands in process-launch adapters.

The step is complete when the CLI has one named OpenDucktor consumer and the host owns its install check.

### 2. Add the ID

Add a stable `ToolDiscoveryId` to `packages/host/src/ports/tool-discovery-port.ts`. Name the tool, not its path or shell.

### 3. Add the descriptor

Add the descriptor to `packages/host/src/adapters/system/tool-discovery.ts`.

```ts
const EXAMPLE_TOOL_DESCRIPTOR = commandTool({
  command: "example",
  displayName: "Example",
  overrideVariable: "OPENDUCKTOR_EXAMPLE_PATH",
});
```

Add product-owned paths only when needed:

```ts
const EXAMPLE_TOOL_DESCRIPTOR = commandTool({
  command: "example",
  displayName: "Example",
  overrideVariable: "OPENDUCKTOR_EXAMPLE_PATH",
  sources: [
    {
      directories: (context) => [context.bundledToolBinDirs.example],
      kind: "searchDirectories",
      label: "bundled tool directory",
      policy: "required",
    },
  ],
});
```

Register it in `TOOL_DISCOVERY_DESCRIPTORS`.

### 4. Use the port

Inject `ToolDiscoveryPort` through composition or the service dependency set.

```ts
const binary = yield* toolDiscovery.resolveToolPath("example");
```

Do not read the variable in the consumer. A workflow can cache one resolved command for its own run. Do not add a second global cache.

### 5. Add diagnostics

Show the tool in runtime health, system diagnostics, or another relevant check when its absence blocks a user path. Diagnostics call `ToolDiscoveryPort` and do not copy descriptor rules.

### 6. Add package paths

If a shell owns a bundled tool:

1. Put the file in that package build.
2. Expose its directory through the package distribution resolver.
3. Add a descriptor `searchDirectories` source for the tool ID.
4. Test source and package modes.

Electron paths come from app resources. Web paths come from the npm package. If the shell already knows an exact executable path, pass it through `providedToolPaths`.

### 7. Test the tool

At minimum, test a valid environment path, an invalid environment path, a missing-tool error, Windows executable types, source and package modes, and source-layer error propagation.

The main test file is `packages/host/src/adapters/system/tool-discovery.test.ts`. Consumer tests check behavior, not the descriptor algorithm.

## Review rules

- Keep discovery in `packages/host`.
- Keep search order, install hints, and variable names in descriptors.
- Keep platform checks in `infrastructure/process` and `SystemCommandPort`.
- Stop on an invalid explicit path.
- Keep package mode independent from worktrees.
- Keep web paths independent from Electron.
- Share descriptor logic across diagnostics, runtimes, and workflows.
- Treat a missing required bundled tool as a package error.
