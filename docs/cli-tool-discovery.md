# CLI And Tool Discovery

## Purpose

OpenDucktor depends on local command line tools:

- Git and GitHub CLI for repository and pull request workflows
- Bun for source-mode MCP startup
- OpenCode, Codex, and Claude Code for agent runtimes

Discovery for these tools must be host-owned, cross-platform, and shell-neutral.
Electron and the web runner both use the TypeScript host, so they must get the same discovery behavior.
Adding a new CLI should mean adding a descriptor and wiring the consumer to `ToolDiscoveryPort`, not adding another shell-specific probe.

## Short Version

Consumers do not search the filesystem themselves.

Most consumers call:

```ts
toolDiscovery.resolveToolPath("codex")
```

Diagnostics that need to explain where an executable came from call:

```ts
toolDiscovery.resolveTool("githubCli")
```

The host resolves that tool by walking its descriptor:

```text
ToolDiscoveryPort
  -> tool descriptor registry
  -> generic explicit paths, ordered descriptor sources, PATH
  -> SystemCommandPort.resolveCommandPath
  -> infrastructure/process platform rules
```

The result is either an executable command path or a typed, actionable host error.

## Ownership Map

| Concern | Owner |
| --- | --- |
| Public tool ids | `packages/host/src/ports/tool-discovery-port.ts` |
| User path parsing and home expansion | `packages/path-support/src/user-path.ts` |
| Tool descriptors and discovery ordering | `packages/host/src/adapters/system/tool-discovery.ts` |
| PATH, PATHEXT, executable-file checks | `packages/host/src/infrastructure/process/process-command-resolution.ts` |
| Command resolution and version probing port | `packages/host/src/adapters/system/system-command-runner.ts` |
| Node host wiring for Electron and web | `packages/host/src/composition/node/node-host-default-ports.ts` |
| Distribution mode input | `packages/host/src/adapters/runtimes/runtime-distribution.ts` |
| Electron distribution selection | `apps/electron/src/main/electron-runtime-distribution.ts` |
| Web distribution selection | `packages/openducktor-web/src/web-runtime-distribution.ts` |

Application services and runtime adapters should depend on `ToolDiscoveryPort`.
They should not read `process.env`, call `which`, inspect app bundles, or hard-code package resource paths.
When a package needs to parse a user-supplied path, it should use the pure helpers in `@openducktor/path-support` and supply any environment-specific home-directory or path-joining behavior at its own boundary.

## Runtime Flow

At host startup, `createNodeHostDefaultPorts` builds:

1. `processEnv` with platform-aware environment normalization
2. `systemCommands` from that environment
3. `toolDiscovery` from `systemCommands`, `processEnv`, shell-provided tool paths, and distribution-owned bundled directories
4. higher-level adapters and services that consume `toolDiscovery`

The same composition path is used by:

- Electron main process through `createElectronHostCommandRouter`
- the local browser backend started by `bunx @openducktor/web`
- workspace web development mode

This is why CLI discovery belongs in `packages/host`, not in shell code.

## Discovery Order

Each tool descriptor declares only the sources that are specific to that tool.
The shared discovery pipeline wraps those descriptor sources with generic explicit paths and PATH.
Discovery stops at the first valid executable source.

### Environment Override

Environment overrides are checked first.

Example:

```text
OPENDUCKTOR_BUN_PATH=/opt/homebrew/bin/bun
```

An override may be an absolute path, a home-relative path such as `~/bin/tool`, or a command name resolvable by the command runner.
Quote trimming and `~` expansion come from `@openducktor/path-support`.

Invalid overrides fail immediately with `HostValidationError`.
There is no fallthrough from a broken explicit override to another source, because that would hide the user's configured state.

### Provided Tool Path

Shells may pass a tool path they already know through Node host composition.
This is a generic `providedToolPaths` map keyed by `ToolDiscoveryId`, not a Bun-specific or shell-specific branch.

Provided paths are checked after environment overrides and before descriptor conventional locations or PATH.
If a provided path is invalid, discovery fails immediately because the shell explicitly promised that path for the current run.

### Descriptor Search Directories

Descriptor-owned directories are used for product-owned or conventional install locations.

Examples:

- package-owned runtime tool directories
- `~/.opencode/bin`

There are two policies:

| Policy | Behavior |
| --- | --- |
| `candidate` | If missing, keep checking later sources. |
| `required` | If configured and missing, fail before checking later sources. |

Use `required` only when the current distribution promises that directory contains the tool.

### Descriptor Candidate Files

Candidate files are explicit executable paths that are not naturally represented as a directory search.

Codex uses this for macOS app bundle locations such as:

```text
/Applications/Codex.app/Contents/Resources/codex
~/Applications/Codex.app/Contents/Resources/codex
```

### PATH

PATH is the final generic source for built-in descriptors.
It uses `SystemCommandPort.resolveCommandPath`, so platform details stay centralized:

- POSIX paths require executable regular files
- POSIX host startup merges the user's login-shell PATH before inherited GUI PATH entries
- Windows uses PATHEXT for command discovery
- Windows accepts runnable command extensions such as `.exe`, `.cmd`, and `.bat`
- directories are not accepted as executable commands

## Current Tool Inventory

| Tool id | Command | Override variable | Extra descriptor sources | Main consumers |
| --- | --- | --- | --- | --- |
| `bun` | `bun` | `OPENDUCKTOR_BUN_PATH` | none | source-mode and web artifact OpenDucktor MCP command |
| `codex` | `codex` | `OPENDUCKTOR_CODEX_BINARY` | bundled directory when provided, macOS Codex.app candidates | Codex runtime startup and health |
| `claude` | `claude` | `OPENDUCKTOR_CLAUDE_BINARY` | none; Claude Code is an external prerequisite | Claude Agent SDK runtime startup and health |
| `git` | `git` | `OPENDUCKTOR_GIT_PATH` | none | Git adapter, diagnostics |
| `githubCli` | `gh` | `OPENDUCKTOR_GH_PATH` | none | GitHub auth, PR detection and sync |
| `opencode` | `opencode` | `OPENDUCKTOR_OPENCODE_BINARY` | bundled directory when provided, `~/.opencode/bin` | OpenCode runtime startup and health |

`OPENDUCKTOR_CLAUDE_BINARY`, `OPENDUCKTOR_CODEX_BINARY`, and
`OPENDUCKTOR_OPENCODE_BINARY` are existing public names.
For new general-purpose tools, prefer `OPENDUCKTOR_<TOOL>_PATH` unless there is already a released compatibility name.

## Distribution Modes

### Source Mode

Source mode is used by local development.

The runtime distribution contains the workspace root.
It does not provide package-owned tool directories.
Discovery uses environment overrides, shell-provided tool paths, descriptor conventional locations, and PATH.

### Electron Packaged Mode

Electron packaged mode passes an artifact runtime distribution.

The packaged MCP launcher is resolved from Electron resources.
Released Electron builds do not package task-store CLIs; task storage is provided by the host-owned SQLite adapter.

Packaged Electron must never point discovery at a development worktree.
Resource paths must come from the packaged app resources for that run.

### Web Package Mode

`bunx @openducktor/web` also uses an artifact runtime distribution.

The MCP launcher is the package-owned `dist/openducktor-mcp.js` script executed by the `bun` tool resolved through `ToolDiscoveryPort`.
The web launcher provides the active Bun executable to `ToolDiscoveryPort`, so `bunx @openducktor/web` launches its MCP script with the same Bun executable that started the package.
The web package does not use Electron resources and does not currently provide bundled runtime tool directories.

Therefore, runtime CLIs such as Git, OpenCode, Codex, and GitHub CLI are discovered through their descriptor overrides, descriptor conventional locations, and PATH unless the web shell has an exact provided path for that tool.
If the web package ever bundles a CLI, its resolver must provide package-owned paths from the npm package layout, not desktop app paths.

## Error Model

Discovery returns typed host failures.

| Scenario | Error type | Why |
| --- | --- | --- |
| Explicit override is empty | `HostValidationError` | The user configured an invalid value. |
| Explicit override points to a missing or non-executable file | `HostValidationError` | The configured value is wrong and should be fixed. |
| Bundled source is configured but missing | `HostDependencyError` | The distribution promised to bundle a tool that is absent. |
| No source finds the tool | `HostDependencyError` | The host dependency is unavailable. |

Missing-tool errors include every checked source and the descriptor install hint.

Example:

```text
bun not found. Checked OPENDUCKTOR_BUN_PATH, PATH. Install bun and ensure it is available on PATH, or set OPENDUCKTOR_BUN_PATH.
```

## Adding A New CLI

Use this checklist when a new host-owned CLI is needed.

### 1. Confirm It Belongs In Tool Discovery

Use `ToolDiscoveryPort` when the CLI is a known OpenDucktor dependency used by host services, runtime startup, diagnostics, storage, GitHub integration, MCP launch, or another host-owned workflow.

Do not add arbitrary user commands to the registry.
For user-configured commands such as dev server scripts, keep using the process-launch adapters and their command-line parsing rules.

### 2. Add The Tool Id

Add a new `ToolDiscoveryId` entry in:

```text
packages/host/src/ports/tool-discovery-port.ts
```

Use a stable semantic id such as `githubCli`, not a shell-specific or package-specific path name.

### 3. Add The Descriptor

Add a descriptor in:

```text
packages/host/src/adapters/system/tool-discovery.ts
```

Prefer the shared `commandTool` helper for standard tools:

```ts
const EXAMPLE_TOOL_DESCRIPTOR = commandTool({
  command: "example",
  displayName: "Example",
  overrideVariable: "OPENDUCKTOR_EXAMPLE_PATH",
});
```

If the tool has product-owned or conventional locations, add descriptor sources.
The shared discovery pipeline checks environment overrides and provided paths before those sources, then PATH after those sources.

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

Then register it in `TOOL_DISCOVERY_DESCRIPTORS`.

### 4. Wire Consumers Through The Port

Consumers should receive `ToolDiscoveryPort` from composition or an application dependency bundle.

Do this:

```ts
const binary = yield* toolDiscovery.resolveToolPath("example");
```

Do not do this:

```ts
const binary = process.env.OPENDUCKTOR_EXAMPLE_PATH ?? "example";
```

The consumer may cache a resolved command for one workflow if that avoids repeated probes, but cache ownership should stay local to that workflow.
Do not add a second global discovery cache.

### 5. Decide Whether Diagnostics Should Show It

If the missing tool blocks a user-visible setup or runtime path, add it to the relevant diagnostics service:

- runtime health for agent runtime CLIs
- system diagnostics for repository/GitHub tools
- task-store diagnostics for the SQLite database path and readiness

Diagnostics should call `ToolDiscoveryPort`.
They should not duplicate descriptor logic.

### 6. Handle Distribution Ownership

If a shell package owns a bundled copy of the CLI:

1. package that binary or script in the shell/package build
2. expose its directory through the shell's runtime distribution resolver
3. add a descriptor `searchDirectories` source keyed by the tool id
4. test source mode and packaged mode separately

For Electron, package paths must come from Electron resources.
For `@openducktor/web`, package paths must come from the npm package layout.
Never reuse a path from another shell, another worktree, or a removed development directory.

If a shell already knows the exact executable path for a tool it is using to run OpenDucktor, pass that path through the host composition `providedToolPaths` input.
Do not add a one-off discovery branch for that shell or tool.

### 7. Add Tests

At minimum, add or update tests for:

- environment override success
- invalid override failure
- missing tool diagnostics listing the override variable
- Windows command discovery when the tool may be a `.cmd`, `.bat`, or `.exe`
- packaged/source distribution behavior when bundled directories are involved
- the consuming service failing at the source layer with the discovery error

The central test file is:

```text
packages/host/src/adapters/system/tool-discovery.test.ts
```

Consumer tests should assert behavior, not reimplement the descriptor search order.

## Design Rules

- Keep CLI discovery in `packages/host`.
- Use descriptors as the source of search order, install hints, and override names.
- Leave low-level platform resolution in `infrastructure/process` and `SystemCommandPort`.
- Avoid Codex-specific, OpenCode-specific, or shell-specific discovery branches.
- Reject invalid explicit overrides instead of falling back to PATH.
- Keep packaged mode independent from source worktrees.
- Keep the web package independent from Electron resources.
- Reuse descriptor search logic from diagnostics, runtime starters, and task workflows.
- Treat missing required bundled tools as distribution errors, not PATH lookup misses.
- Keep errors actionable and specific to the failed source.

The goal is deliberately boring: one port, one descriptor registry, one platform command resolver, many consumers.
