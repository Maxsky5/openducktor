# Contributing To OpenDucktor

Thanks for contributing. This project is public, but it is still early and the codebase is moving quickly. The best contributions are narrow, well-tested, and aligned with the current product direction.

## Before You Start

- Read [README.md](README.md) for the product overview and end-user install path.
- Read [docs/README.md](docs/README.md) for the documentation map.
- Open an issue or discussion before starting large changes, new features, or architectural refactors.

## Current Product Constraints

Please keep these constraints in mind when proposing or implementing changes:

- OpenDucktor currently focuses on macOS only.
- The only supported agent runtime today is OpenCode (`opencode`).
- Codex is the next planned runtime, but it is not implemented yet.
- OpenDucktor will support open-source agent runtimes only.
- Beads is the V1 source of truth for tasks.

## Quick Start

For most contributors, the recommended local setup is the CEF path. Release builds use CEF, and it avoids the WebKit issues we have seen during development.

1. Install the core tooling: Bun `1.3.11`, Rust stable, Xcode Command Line Tools, `git`, `bd`, and `opencode`.
2. Install the CEF prerequisites:

```sh
brew install cmake ninja
```

3. Install workspace dependencies from the repository root:

```sh
bun install
```

That install also activates the repository's shared local Git hooks through the root `prepare` script.

4. Use a dedicated development config directory so your local contributor data stays separate from your regular app data:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"
```

5. Bootstrap the CEF toolchain:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:setup:cef
```

6. Start the desktop app with CEF:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:dev:cef
```

Useful alternatives:

- Faster fallback for local iteration without CEF parity: `bun run tauri:dev`
- Browser mode if you want agents to access it with tools like `agent-browser`: `bun run browser:dev`

## Local Tooling Reference

Core tooling:

- Bun `1.3.11`
- Rust stable
- Xcode Command Line Tools
- `git`
- `bd`
- `opencode`

Additional tooling:

- `cmake` and `ninja` for the recommended CEF flow, packaging, and release work

Notes:

- Local source builds expect a local `bd` install. The released desktop app bundles Beads for end users, but contributor builds do not rely on that packaged sidecar.
- OpenDucktor resolves `opencode` from `PATH` first, then falls back to `~/.opencode/bin/opencode`.
- You can override the OpenCode binary path with `OPENDUCKTOR_OPENCODE_BINARY`.
- OpenDucktor manages its own Beads and Dolt storage under the OpenDucktor config directory. You do not need a separate local Dolt install for normal development.

## Main Development Commands

Recommended for local development: keep contributor data isolated with `OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"` in your shell session or prefixed on commands.

Recommended desktop flow with CEF:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:dev:cef
```

Fallback desktop flow with WebKit:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:dev
```

Browser mode for UI validation against the real backend:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run browser:dev
```

## CEF Development And Build Flow

This section covers the recommended contributor setup and the release build path.

This section assumes `cmake` and `ninja` are already installed, as shown in Quick Start.

Bootstrap the CEF toolchain:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:setup:cef
```

That command:

- requires `cmake` and `ninja` to already be available on `PATH`
- installs `cargo-tauri` from the exact Tauri `feat/cef` revision locked in `apps/desktop/src-tauri/Cargo.lock`
- exports CEF into a shared OpenDucktor cache directory versioned by the resolved `cef` crate version
- clears the macOS quarantine attribute from the downloaded CEF bundle

By default, worktrees share the same local cache under `~/.openducktor/cache/`, so you do not need to rerun the full bootstrap for every git worktree.

Default shared cache locations:

- `cargo-tauri`: `~/.openducktor/cache/cargo-tools/tauri-feat-cef/<tauri-revision-prefix>/`
- `export-cef-dir`: `~/.openducktor/cache/cargo-tools/export-cef-dir/<cef-version>/`
- exported CEF bundle: `~/.openducktor/cache/cef/<cef-version>/`

Start the desktop app with the CEF runtime:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:dev:cef
```

Build a macOS CEF bundle:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:build:cef
```

Environment variables:

- `OPENDUCKTOR_CARGO_TOOLS_ROOT` sets the install root for the shared `cargo-tauri` and `export-cef-dir` binaries.
- `OPENDUCKTOR_CEF_PATH` sets the exported CEF bundle directory used by the setup, dev, and build wrappers.
- `CEF_PATH` is still honored for upstream compatibility when `OPENDUCKTOR_CEF_PATH` is unset.

On macOS, `tauri:dev:cef` uses `apps/desktop/src-tauri/tauri.cef-dev.conf.json`, so it runs as a separate app identity from the packaged CEF build:

- app bundle name: `OpenDucktor CEF Dev.app`
- bundle identifier: `dev.openducktor.desktop.cefdev`
- main window title: `OpenDucktor CEF Dev`

If you run Cargo directly for CEF checks, use `--no-default-features --features cef` so upstream Tauri does not enable both `wry` and `cef` at the same time.

## Verification Commands

Run the main workspace checks from the repository root:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run check:rust
bun run test:rust
```

Useful focused commands:

```sh
bun run --filter @openducktor/core test
bun run --filter @openducktor/desktop test
bun run --filter @openducktor/desktop typecheck
bun run --filter @openducktor/desktop lint
cd apps/desktop/src-tauri && cargo test -p host-domain
cd apps/desktop/src-tauri && cargo test -p host-infra-beads
cd apps/desktop/src-tauri && cargo test -p host-application
```

Additional Rust verification when needed:

```sh
cd apps/desktop/src-tauri && cargo fmt --all --check
cd apps/desktop/src-tauri && cargo clippy --workspace --all-targets -- -D warnings
```

## Local Git Hooks

Shared local Git hooks run on every commit once you have run `bun install`.

- `pre-commit` runs `bun run lint`, `bun run typecheck`, and `bun run check:rust` in that order.
- `commit-msg` enforces Conventional Commits.
- `bun run test`, `bun run test:rust`, and `bun run build` are intentionally not part of the per-commit hook.
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

You can either export it for your shell session:

```sh
export OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev"
```

Or prefix individual commands:

```sh
OPENDUCKTOR_CONFIG_DIR="$HOME/.openducktor-dev" bun run tauri:dev:cef
```

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
- Core, adapters, MCP, and Rust host changes should include targeted tests in the touched area.
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
