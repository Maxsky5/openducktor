# CLI And Tool Discovery

## Purpose

OpenDucktor depends on local command line tools:

- Git and GitHub CLI for repository and pull request workflows
- Beads and Dolt for task storage
- Bun for source-mode MCP startup
- OpenCode and Codex for agent runtimes

Discovery for these tools must be host-owned, cross-platform, and shell-neutral.
Electron and the web runner both use the TypeScript host, so they must get the same discovery behavior.
Adding a new CLI should mean adding a descriptor and wiring the consumer to `ToolDiscoveryPort`, not adding another shell-specific probe.

## Short Version

Consumers do not search the filesystem themselves.

They call:

```ts
toolDiscovery.resolveToolPath("codex")
```

The host resolves that tool by walking its descriptor:

```text
ToolDiscoveryPort
  -> tool descriptor registry
  -> ordered descriptor sources
  -> SystemCommandPort.resolveCommandPath
  -> process-command-resolution platform rules
```

The result is either an executable command path or a typed, actionable host error.

## Ownership Map

| Concern | Owner |
| --- | --- |
| Public tool ids | `packages/host/src/ports/tool-discovery-port.ts` |
| Tool descriptors and source ordering | `packages/host/src/adapters/system/tool-discovery.ts` |
| PATH, PATHEXT, executable-file checks | `packages/host/src/adapters/process/process-command-resolution.ts` |
| Command resolution and version probing port | `packages/host/src/adapters/system/system-command-runner.ts` |
| Node host wiring for Electron and web | `packages/host/src/composition/node/node-host-default-ports.ts` |
| Distribution mode input | `packages/host/src/adapters/runtimes/runtime-distribution.ts` |
| Electron distribution selection | `apps/electron/src/main/electron-runtime-distribution.ts` |
| Web distribution selection | `packages/openducktor-web/src/web-runtime-distribution.ts` |

Application services and runtime adapters should depend on `ToolDiscoveryPort`.
They should not read `process.env`, call `which`, inspect app bundles, or hard-code package resource paths.

## Runtime Flow

At host startup, `createNodeHostDefaultPorts` builds:

1. `processEnv` with platform-aware environment normalization
2. `systemCommands` from that environment
3. `toolDiscovery` from `systemCommands`, `processEnv`, and distribution-owned bundled directories
4. higher-level adapters and services that consume `toolDiscovery`

The same composition path is used by:

- Electron main process through `createElectronHostCommandRouter`
- the local browser backend started by `bunx @openducktor/web`
- workspace web development mode

This is why CLI discovery belongs in `packages/host`, not in shell code.

## Descriptor Sources

Each tool descriptor declares an ordered list of sources.
Discovery stops at the first valid executable source.

### Environment Override

Environment overrides are checked first.

Example:

```text
OPENDUCKTOR_BUN_PATH=/opt/homebrew/bin/bun
```

An override may be an absolute path, a home-relative path such as `~/bin/tool`, or a command name resolvable by the command runner.

Invalid overrides fail immediately with `HostValidationError`.
There is no fallthrough from a broken explicit override to another source, because that would hide the user's configured state.

### Search Directories

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

### Candidate Files

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
- Windows uses PATHEXT for command discovery
- Windows accepts runnable command extensions such as `.exe`, `.cmd`, and `.bat`
- directories are not accepted as executable commands

## Current Tool Inventory

| Tool id | Command | Override variable | Extra descriptor sources | Main consumers |
| --- | --- | --- | --- | --- |
| `beads` | `bd` | `OPENDUCKTOR_BD_PATH` | none | Beads task store, diagnostics |
| `bun` | `bun` | `OPENDUCKTOR_BUN_PATH` | none | source-mode OpenDucktor MCP command |
| `codex` | `codex` | `OPENDUCKTOR_CODEX_BINARY` | bundled directory when provided, macOS Codex.app candidates | Codex runtime startup and health |
| `dolt` | `dolt` | `OPENDUCKTOR_DOLT_PATH` | none | shared Dolt server, Beads diagnostics |
| `git` | `git` | `OPENDUCKTOR_GIT_PATH` | none | Git adapter, diagnostics |
| `githubCli` | `gh` | `OPENDUCKTOR_GH_PATH` | none | GitHub auth, PR detection and sync |
| `opencode` | `opencode` | `OPENDUCKTOR_OPENCODE_BINARY` | bundled directory when provided, `~/.opencode/bin` | OpenCode runtime startup and health |

`OPENDUCKTOR_CODEX_BINARY` and `OPENDUCKTOR_OPENCODE_BINARY` are existing public names.
For new general-purpose tools, prefer `OPENDUCKTOR_<TOOL>_PATH` unless there is already a released compatibility name.

## Distribution Modes

### Source Mode

Source mode is used by local development.

The runtime distribution contains the workspace root.
It does not provide package-owned tool directories.
Discovery uses environment overrides, descriptor conventional locations, and PATH.

### Electron Packaged Mode

Electron packaged mode passes an artifact runtime distribution.

The packaged MCP launcher is resolved from Electron resources.
If Electron later bundles additional CLI tools, Electron must pass package-owned `bundledToolBinDirs` for those tools.
Descriptors may then add a `searchDirectories` source that points at that tool id's bundled directory.

Packaged Electron must never point discovery at a development worktree.
Resource paths must come from the packaged app resources for that run.

### Web Package Mode

`bunx @openducktor/web` also uses an artifact runtime distribution.

The MCP launcher is the package-owned `dist/openducktor-mcp.js` script executed by the current Bun executable.
The web package does not use Electron resources and does not currently provide bundled runtime tool directories.

Therefore, runtime CLIs such as Git, Beads, Dolt, OpenCode, Codex, and GitHub CLI are discovered through their descriptor overrides, descriptor conventional locations, and PATH.
If the web package ever bundles a CLI, its resolver must provide package-owned paths from the npm package layout, not desktop app paths.

### Legacy Tauri Path

The Rust host still has equivalent command resolution for the legacy Tauri path.

When adding a tool that must work through Tauri-hosted functionality, keep the Rust resolver and diagnostics in parity.
For Electron and web, the TypeScript host descriptor registry is the source of truth.

## Error Model

Discovery returns typed host failures.

| Scenario | Error type | Why |
| --- | --- | --- |
| Explicit override is empty | `HostValidationError` | The user configured an invalid value. |
| Explicit override points to a missing or non-executable file | `HostValidationError` | The configured value is wrong and should be fixed. |
| Required bundled source is configured but missing | `HostDependencyError` | The distribution promised a tool that is absent. |
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
export const EXAMPLE_TOOL_DESCRIPTOR = commandTool({
  command: "example",
  displayName: "Example",
  overrideVariable: "OPENDUCKTOR_EXAMPLE_PATH",
});
```

If the tool has product-owned or conventional locations, add descriptor sources between the override and PATH:

```ts
export const EXAMPLE_TOOL_DESCRIPTOR = commandTool({
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
- Beads diagnostics for Beads or Dolt storage tools

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

### 7. Keep Tauri Parity When Needed

If the tool is used by still-active Tauri/Rust host behavior, update the Rust resolver and integration tests in the same change.

If the tool is TypeScript-host-only, call that out in the PR so reviewers do not assume the legacy path changed.

### 8. Add Tests

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
- Keep descriptors as the source of search order, install hints, and override names.
- Keep low-level platform resolution in `process-command-resolution.ts` and `SystemCommandPort`.
- Do not add Codex-specific, OpenCode-specific, or shell-specific discovery branches.
- Do not fall back from an invalid explicit override to PATH.
- Do not let packaged mode point at source worktrees.
- Do not let the web package point at Electron or Tauri resources.
- Do not duplicate descriptor search logic in diagnostics, runtime starters, or task workflows.
- Do not mask missing required bundled tools with PATH lookup.
- Keep errors actionable and specific to the failed source.

The goal is boring on purpose: one port, one descriptor registry, one platform command resolver, many consumers.
