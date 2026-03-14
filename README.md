# OpenDucktor

OpenDucktor is a desktop app for AI-assisted software delivery. It combines a Tauri v2 host, a React frontend, a Rust application layer, and Beads as the task source of truth to orchestrate spec, planning, build, and QA workflows around real repository work.

## Status

OpenDucktor is still very early.

- The repository is public so the work can be inspected, discussed, and improved in the open.
- It is not production-ready yet.
- Breaking changes should be expected.
- Setup is still manual in places, and contributor ergonomics are still being improved.

If you want to follow the project, treat the current codebase as an active prototype rather than a stable product.

## Current Scope

- Platform support today: macOS only.
- Planned later: Windows and Linux, after the project reaches a first stable version.
- Supported task backend: Beads.
- Supported agent runtime today: OpenCode (`opencode`) only.
- Next planned runtime: Codex.
- Runtime policy: OpenDucktor will support open source agent runtimes only (I'm watching you Claude Code).

## What OpenDucktor Does

OpenDucktor is built around a workflow where tasks live in Beads and agent work stays connected to those tasks.

- Beads is the lifecycle source of truth.
- OpenDucktor manages spec, plan, build, and QA workflows on top of that task model.
- Agent-authored documents are stored as task metadata instead of being scattered across ad hoc files.
- The desktop app coordinates repository checks, runtime startup, task transitions, and local workflow tooling.

## Repository Layout

- `apps/desktop`: React + Vite frontend and Tauri desktop app.
- `apps/desktop/src-tauri`: Rust host application and infrastructure crates.
- `packages/contracts`: Shared TypeScript contracts and schemas.
- `packages/core`: Core domain services and ports.
- `packages/adapters-opencode-sdk`: OpenCode runtime adapter for the TypeScript agent engine boundary.
- `packages/adapters-tauri-host`: Frontend adapter for typed Tauri IPC.
- `packages/openducktor-mcp`: MCP server exposing the `odt_*` workflow tools.
- `docs/`: architecture, workflow, runtime, and security documentation.

## Running Locally

### Prerequisites

OpenDucktor currently targets local macOS development.

- Bun `1.3.5` or newer
- Rust stable toolchain
- Xcode Command Line Tools
- `git`
- `gh`
- `bd` (Beads CLI)
- `opencode` (OpenCode CLI/runtime)

OpenDucktor resolves `opencode` from `PATH` first, then falls back to `~/.opencode/bin/opencode`. You can also override the binary path with `OPENDUCKTOR_OPENCODE_BINARY`.

### Install Dependencies

```sh
bun install
```

### Start The Desktop App

```sh
bun run tauri:dev
```

### Start in Browser Mode (allow agents to test what they are doing)

```sh
bun run browser:dev
```

### Useful Checks

```sh
bun run lint
bun run typecheck
bun run test
bun run build
cd apps/desktop/src-tauri && cargo check
cd apps/desktop/src-tauri && cargo test
```

### Local Data And Config

OpenDucktor stores local config at:

- `~/.openducktor/config.json`

Beads storage is managed centrally per repository in:

- `~/.openducktor/beads/`

The app initializes and uses a central Beads directory for each repository. Existing repo-local `.beads` folders are not the V1 source of truth.

## Contributing

Contributions are welcome, but this repository is still changing quickly. Before spending time on a large change, open an issue or start a discussion so the direction is aligned first.

Short version:

1. Fork the repo and create a branch.
2. Install the required local tooling, including `bd` and `opencode`.
3. Make the smallest coherent change that solves one problem.
4. Add or update tests for touched behavior.
5. Run the relevant checks before opening a pull request.
6. Use Conventional Commits for commit messages.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor workflow and expectations.

## Documentation

Start here:

- [docs/README.md](docs/README.md)

Key references:

- [docs/architecture-overview.md](docs/architecture-overview.md)
- [docs/runtime-integration-guide.md](docs/runtime-integration-guide.md)
- [docs/task-workflow-status-model.md](docs/task-workflow-status-model.md)
- [docs/task-workflow-actions.md](docs/task-workflow-actions.md)
- [docs/task-workflow-transition-matrix.md](docs/task-workflow-transition-matrix.md)

## License

This repository is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
