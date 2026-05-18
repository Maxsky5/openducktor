# OpenDucktor

OpenDucktor is an Agentic Development Environment built around tasks, repositories, and local agent runtimes.

It uses [Beads](https://github.com/steveyegge/beads) as the task source of truth, orchestrates Specification, Planner, Builder, and QA sessions, and keeps documents, approvals, and delivery state attached to each task instead of scattered across chat threads.

![Kanban board placeholder](docs/assets/screenshots/kanban-board.png)

<details>
<summary>More screenshots</summary>

![Agent Studio placeholder](docs/assets/screenshots/agent-studio-builder.png)

![Agent Studio placeholder](docs/assets/screenshots/agent-studio-planner.png)

![Agent Studio placeholder](docs/assets/screenshots/agent-studio-spec-question.png)

![Agent Studio placeholder](docs/assets/screenshots/settings-repo-config.png)

![Agent Studio placeholder](docs/assets/screenshots/settings-autopilot.png)

![Agent Studio placeholder](docs/assets/screenshots/settings-customize-prompts.png)

![Agent Studio placeholder](docs/assets/screenshots/settings-default-models.png)

![Agent Studio placeholder](docs/assets/screenshots/create-task-1.png)

![Agent Studio placeholder](docs/assets/screenshots/create-task-2.png)

</details>

## Install OpenDucktor

### Homebrew (macOS only)

```sh
brew tap Maxsky5/openducktor
brew install --cask openducktor
```

### Direct Download (macOS, Linux & Windows)

1. Open the [GitHub Releases page](https://github.com/Maxsky5/openducktor/releases).
2. Download the latest desktop asset that matches your machine.
3. Launch OpenDucktor and open the local repository you want to work on.

If macOS blocks the first launch, use Finder's standard `Open` action once to confirm you want to run the app.

Homebrew installs the same signed and notarized desktop app that is published on GitHub Releases.

Windows and Linux desktop builds are published from the Electron release pipeline, but they are experimental. They are useful for feedback and compatibility testing, not yet as stable as the macOS build. Please open issues with platform details, logs, and the action you were trying to perform.

### Local Web Runner (macOS, Linux & Windows)

If you prefer to use OpenDucktor in a browser instead of a desktop window:

```sh
bunx @openducktor/web
```

The web runner opens OpenDucktor in your browser. Choose the desktop app or the web runner based on what best fits your workflow.

## User Prerequisites

OpenDucktor is macOS-first. Windows and Linux support is experimental.

- `git`
- `opencode` or `codex`
- `gh` plus `gh auth login` if you use GitHub and want OpenDucktor to open pull requests for you

OpenDucktor supports local OpenCode and Codex runtimes. OpenCode remains the default runtime. Runtime discovery checks configured overrides, common local install locations, and `PATH`.

[Beads](https://github.com/steveyegge/beads) is bundled with the desktop app, so installing `bd` separately is not required.

## Core Features

- Task-first workflow with a Kanban board as the main operational view.
- Role-specific agent sessions for Specification, Planner, Builder, and QA.
- Autopilot rules that can automatically start the next workflow action when task transitions are observed.
- Task-linked documents for specifications, implementation plans, and QA reports.
- A dedicated Git worktree for each Builder task, with in-app tools to inspect diffs, track Git state, and run dev servers while implementation is in progress.
- Runtime-aware Agent Studio support for OpenCode and Codex, including model selection, history hydration, permissions/questions, and workflow-tool routing through the runtime descriptor model.
- Global and repository-level prompt customization for adapting agent behavior to your workflow.
- A built-in OpenDucktor MCP server used internally by managed agent sessions and available externally through `@openducktor/mcp`.
- A local web runner available through `@openducktor/web` for running the shared frontend with the TypeScript host in a browser.

## How It Works

OpenDucktor is built around [Beads](https://github.com/steveyegge/beads) tasks, with the desktop app orchestrating the workflow around them.

At a high level:

1. Tasks and workflow state live in Beads.
2. OpenDucktor starts role-specific sessions for Specification, Planner, Builder, and QA.
3. Agent-authored outputs such as specs, plans, and QA reports are stored back on the task.
4. Builder work happens in a dedicated Git worktree for the task, so implementation stays isolated from the main checkout.
5. Reviews, approvals, and pull request delivery remain connected to that same task.

Under the hood, OpenDucktor exposes its own MCP server, `openducktor`.

Desktop-managed sessions use that MCP internally, and the same task surface is also available outside the app through `@openducktor/mcp`.

That keeps the workflow task-centric and auditable: agents act through a controlled task interface, while OpenDucktor keeps task state, documents, approvals, and delivery history connected in one place.

## Architecture Notes

OpenDucktor uses shared Zod contracts in `packages/contracts` for public runtime, task, workflow, host-bridge, and MCP payloads. The shared React app lives in `packages/frontend` and uses TanStack Query as the cache and deduplication layer for server-owned reads.

The TypeScript host in `packages/host` is the Effect-native host boundary used by the Electron shell and the local web runner. Effect owns internal host execution concerns such as typed failures, dependency wiring, I/O orchestration, resource lifecycle, and boundary wrapping, while Promise APIs remain at shell-facing transport edges.

## Current Scope

- Platform support today: macOS is the primary supported desktop target.
- Windows and Linux: experimental Electron desktop builds. Feedback is welcome, but these builds are not stable yet.
- [Beads](https://github.com/steveyegge/beads) is the V1 task source of truth
- Supported runtimes today: OpenCode (`opencode`) and Codex (`codex`)
  - OpenCode remains the default runtime.
  - More runtimes may be added through the runtime descriptor and adapter model.
- The project is still early and should be treated as an active prototype

## Documentation

- [docs/README.md](docs/README.md)
- [docs/architecture-overview.md](docs/architecture-overview.md)
- [docs/tanstack-query-cache-strategy.md](docs/tanstack-query-cache-strategy.md)
- [docs/runtime-integration-guide.md](docs/runtime-integration-guide.md)
- [docs/web-runner.md](docs/web-runner.md)
- [docs/task-workflow-status-model.md](docs/task-workflow-status-model.md)

## Contributing

Contributor setup, local build instructions, CEF details, and verification commands live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This repository is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
