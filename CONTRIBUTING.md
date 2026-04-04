# Contributing To OpenDucktor

Thanks for contributing. This project is public, but it is still early and the codebase is moving quickly. The best contributions are narrow, well-tested, and aligned with the current product direction.

## Before You Start

- Read [README.md](README.md) for project scope and setup.
- Read [docs/README.md](docs/README.md) for the documentation map.
- Open an issue or discussion before starting large changes, new features, or architectural refactors.

## Current Product Constraints

Please keep these constraints in mind when proposing or implementing changes:

- OpenDucktor currently focuses on macOS only.
- The only supported agent runtime today is OpenCode (`opencode`).
- Codex is the next planned runtime, but it is not implemented yet.
- OpenDucktor will support open-source agent runtimes only.
- Claude Code is intentionally out of scope.
- Beads is the V1 source of truth for tasks.

## Local Setup

Required local tooling:

- Bun `1.3.11`
- Rust stable
- Xcode Command Line Tools
- `git`
- `gh`
- `bd`
- `opencode`

Install workspace dependencies from the repository root:

```sh
bun install
```

Run the desktop app:

```sh
bun run tauri:dev
```

Useful checks:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run check:rust
bun run test:rust
```

## Development Expectations

- Keep changes consistent with the current hexagonal boundaries.
- Update shared contracts first when a cross-layer payload changes.
- Do not add fallback logic that hides failures.
- Prefer actionable errors over silent defaults.
- Keep docs in sync with behavior when changing workflows, runtime contracts, or security assumptions.

## Tests

- Add or update tests for non-trivial behavior changes.
- Frontend behavior changes should include frontend tests.
- Core, adapters, MCP, and Rust host changes should include targeted tests in the touched area.
- Run the relevant checks before opening a pull request.

## Pull Requests

When opening a pull request:

- Explain the user-facing or maintainer-facing problem being solved.
- Keep the change set focused.
- Call out any follow-up work that is intentionally left out.
- Mention any setup assumptions, migrations, or breaking changes.

## Commit Messages

Use Conventional Commits where practical.

Examples:

- `feat: add runtime capability validation for session hydration`
- `fix: keep task workflow transitions fail-fast`
- `docs: rewrite public README and contribution guide`
