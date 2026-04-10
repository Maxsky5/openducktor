# Desktop and MCP release process

OpenDucktor releases are now owned by GitHub Actions. Maintainers do not need to run local release commands or create tags by hand.

## Workflow layout

The release flow is split into three workflows:

- `.github/workflows/release-prep.yml`
- `.github/workflows/release-desktop.yml`
- `.github/workflows/publish-mcp.yml`

### 1. Prepare Release

`Prepare Release` is the only workflow a maintainer starts manually.

- Trigger: `workflow_dispatch`
- Input: `version` like `0.1.0`

It does all release preparation work:

- validates the requested version
- updates repo version manifests
- refreshes `bun.lock`
- creates the release bump commit on the default branch
- creates one tag:
  - `v0.1.0` for the desktop release and MCP publish
- dispatches the desktop and MCP publish workflows

### 2. Release Desktop

`Release Desktop` is dispatched by `Prepare Release` with a desktop tag input such as `v0.1.0`.

It:

- validates that the checked-out repo state matches the tag version
- creates or reuses a **draft GitHub release**
- runs the repo's CEF bootstrap step
- builds macOS assets for:
  - Apple Silicon (`aarch64-apple-darwin`)
  - Intel (`x86_64-apple-darwin`)
- uploads those assets to the draft GitHub release via `tauri-action`

Signing is controlled by the repository variable `APPLE_SIGNING_ENABLED`:

- when `false` or unset, the workflow builds unsigned desktop binaries
- when `true`, the workflow requires Apple signing credentials and produces signed builds

The release remains a **draft** so maintainers can smoke-test the downloaded assets before publishing.

### 3. Publish MCP Package

`Publish MCP Package` is dispatched by `Prepare Release` with the shared release tag such as `v0.1.0`.

It:

- validates that `packages/openducktor-mcp/package.json` matches the tag version
- verifies the MCP package
- publishes `@openducktor/mcp` to npmjs

## Why this design

OpenDucktor uses a CEF-specific Tauri flow:

- `bun run tauri:setup:cef`
- repo-specific path resolution from `apps/desktop/scripts/cef-paths.ts`

Those scripts pin `cargo-tauri` to the exact Tauri `feat/cef` revision locked in `apps/desktop/src-tauri/Cargo.lock`, export CEF into the shared OpenDucktor cache, and clear the downloaded bundle's macOS quarantine bit.

The release workflow keeps those OpenDucktor-specific setup steps, then hands the actual desktop build/upload to `tauri-action`. That gives you a more standard Tauri publish layer without throwing away the CEF bootstrap the repo already depends on.

## Release notes

Desktop release notes use **GitHub-generated release notes**.

- `.github/release.yml` defines the category mapping
- the draft GitHub release is created with `--generate-notes`
- maintainers can review and edit the draft notes before publishing

That keeps release notes simple and reviewable for the first release line.

## Required GitHub secrets

### Desktop release secrets

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

Notes:

- `APPLE_CERTIFICATE` must be a base64-encoded `.p12` signing certificate.
- The Apple secrets are only required when `APPLE_SIGNING_ENABLED=true`.
- Certificate import is handled by `apple-actions/import-codesign-certs`.

### MCP publish secrets

- `NPM_TOKEN`

### Release automation secret

- `RELEASE_AUTOMATION_TOKEN`

`Prepare Release` requires this token and refuses to push with the default GitHub Actions token. That keeps release automation aligned with normal repository protection and review expectations.

## How versioning works

The repo still uses a small helper script to keep version sources aligned, but the workflow owns when it runs.

The version sync touches:

- root `package.json`
- workspace package manifests discovered from the root `workspaces` configuration
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml` (`[package]` and `[workspace.package]`)
- `bun.lock`

The helper script remains useful because this repo spans three version domains:

- Bun workspace package manifests
- Tauri config
- Cargo workspace/root package metadata

## Recommended release sequence

1. Open GitHub Actions.
2. Run `Prepare Release`.
3. Enter the target version, for example `0.1.0`.
4. Wait for `Prepare Release` to finish.
5. Wait for `Release Desktop` to finish.
6. Wait for `Publish MCP Package` to finish.
7. Open the draft GitHub release and smoke-test the desktop assets.
8. Publish the draft release when the assets and notes look correct.

## Asset policy for the first release line

OpenDucktor is currently macOS-first, so the desktop workflow publishes macOS artifacts only.

The workflow does **not** generate a public updater channel yet. That should wait until the in-app updater flow is explicitly wired and tested. The current release pipeline is focused on reliable GitHub Releases distribution first, plus npm publishing for `@openducktor/mcp`.
