# Contributing To OpenDucktor

Thanks for contributing. This project is public, but it is still early and the codebase is moving quickly. The best contributions are narrow, well-tested, and aligned with the current product direction.

## Before You Start

- Read [README.md](README.md) for the product overview and end-user install path.
- Read [docs/README.md](docs/README.md) for the documentation map.
- Open an issue or discussion before starting large changes, new features, or architectural refactors.

## Current Product Constraints

- OpenDucktor is macOS-first, with Windows and Linux Electron builds treated as experimental.
- Beads is the V1 source of truth for tasks.
- OpenCode and Codex are the supported local agent runtimes.
- OpenDucktor will support open-source agent runtimes only.

## Quick Start

1. Install the core tooling: Bun `1.3.11`, Xcode Command Line Tools, `git`, `bd`, and at least one supported runtime (`opencode` or `codex`).
2. Install workspace dependencies from the repository root:

```sh
bun install
```

That install also activates the repository's shared local Git hooks through the root `prepare` script.

3. Use a dedicated development config directory so your local contributor data stays separate from your regular app data:

```sh
export OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"
```

4. Start the Electron desktop app:

```sh
bun run electron:dev
```

Useful alternative:

- Browser mode if you want agents to access it with tools like `agent-browser`: `bun run browser:dev`.

## Local Tooling Reference

Core tooling:

- Bun `1.3.11`
- Xcode Command Line Tools
- `git`
- `bd`
- `opencode` or `codex`

Notes:

- Local source builds expect a local `bd` install. The released desktop app bundles Beads for end users, but contributor builds do not rely on that packaged sidecar.
- OpenDucktor resolves `opencode` from `PATH` first, then falls back to `~/.opencode/bin/opencode`.
- You can override the OpenCode binary path with `OPENDUCKTOR_OPENCODE_BINARY`.
- OpenDucktor manages its own Beads and Dolt storage under the OpenDucktor config directory. You do not need a separate local Dolt install for normal development.

## Main Development Commands

Recommended for local development: keep contributor data isolated with `OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"` in your shell session.

Electron desktop:

```sh
bun run electron:dev
```

Browser mode for UI validation against the real backend:

```sh
bun run browser:dev
```

The browser command starts the TypeScript host on `127.0.0.1`, serves the shared frontend with Vite, and requires the web shell to use the explicit local-host HTTP/SSE bridge. Shared frontend code must use the shell bridge instead of importing shell internals directly; run `bun run frontend:boundary-guard` after shell-boundary changes.

## Verification Commands

Run the main workspace checks from the repository root:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```

Useful focused commands:

```sh
bun run --filter @openducktor/core test
bun run --filter @openducktor/electron test
bun run --filter @openducktor/electron typecheck
bun run --filter @openducktor/electron lint
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/web test
```

## Local Git Hooks

Shared local Git hooks run on every commit once you have run `bun install`.

- `pre-commit` runs `bun run lint` and `bun run typecheck` in that order.
- `commit-msg` enforces Conventional Commits.
- `bun run test` does not run during `pre-commit`.
- `git commit --no-verify` still bypasses local hooks; this repository does not try to prevent that.

If you used `bun install --ignore-scripts`, cloned with dependencies already present but hooks inactive, or local Git hook wiring stopped working, reinstall the tracked hooks from the repository root:

```sh
bun run hooks:install
```

Example commit messages:

- `feat: add runtime capability validation for session hydration`
- `fix: keep task workflow transitions fail-fast`
- `docs: rewrite public README and contribution guide`

## Local Data And Config

OpenDucktor resolves its base directory to `~/.openducktor` by default. You can override this with `OPENDUCKTOR_CONFIG_DIR`.

For local development, it is recommended to use a separate config root such as `OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"` so contributor state, Beads data, and runtime caches stay isolated from your normal app usage.

Important paths:

- config file: `$OPENDUCKTOR_CONFIG_DIR/config.json` or `~/.openducktor/config.json`
- managed Beads root: `$OPENDUCKTOR_CONFIG_DIR/beads/` or `~/.openducktor/beads/`
- shared Dolt data: `$OPENDUCKTOR_CONFIG_DIR/beads/shared-server/dolt/`

OpenDucktor uses one shared Dolt server per config root and keeps repository-specific Beads attachment state under the same managed root. Existing repo-local `.beads` folders are not the V1 source of truth.

## Development Expectations

- Keep changes consistent with the current hexagonal boundaries.
- Update shared contracts first when a cross-layer payload changes.
- Do not add fallback logic that hides failures.
- Prefer actionable errors over silent defaults.
- Keep docs in sync with behavior when changing workflows, runtime contracts, or security assumptions.

## Tests

- Add or update tests for non-trivial behavior changes.
- Frontend behavior changes should include frontend tests.
- Core, adapters, MCP, and host changes should include targeted tests in the touched area.
- Run the relevant checks before opening a pull request.

## Pull Requests

When opening a pull request:

- Explain the user-facing or maintainer-facing problem being solved.
- Keep the change set focused.
- Call out any follow-up work that is intentionally left out.
- Mention any setup assumptions, migrations, or breaking changes.

## Commit Messages

Use Conventional Commits.

The shared `commit-msg` hook validates this locally before the commit is created.

Examples:

- `feat: add runtime capability validation for session hydration`
- `fix: keep task workflow transitions fail-fast`
- `docs: rewrite public README and contribution guide`
