# Desktop, Web, and MCP release process

OpenDucktor releases are now owned by GitHub Actions. Maintainers do not need to run local release commands or create tags by hand.

## Workflow layout

The release flow is split into these workflows:

- `.github/workflows/release-prep.yml`
- `.github/workflows/release-desktop-tauri.yml`
- `.github/workflows/release-desktop-electron.yml`
- `.github/workflows/publish-mcp.yml`
- `.github/workflows/publish-web.yml`
- `.github/workflows/publish-homebrew-tap.yml`

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
- creates the draft GitHub release with generated notes after the commit and tag are pushed
- dispatches the Tauri desktop, Electron desktop, MCP, and web publish workflows explicitly after the draft exists

The same release version applies to the desktop apps, `@openducktor/mcp`, and `@openducktor/web`.

### 2. Release Desktop Tauri

`Release Desktop Tauri` is dispatched by `Prepare Release` with the release tag `v0.1.0` and can also be rerun manually with the same tag if needed.

It:

- validates that the checked-out repo state matches the tag version
- verifies that the draft GitHub release already exists
- installs the packaged Beads sidecar prerequisites on the runner (`bd` and `dolt`)
- runs the repo's CEF bootstrap step
- signs and notarizes the macOS bundles
- builds macOS assets for:
  - Apple Silicon (`aarch64-apple-darwin`)
  - Intel (`x86_64-apple-darwin`)
- uploads those assets to the draft GitHub release via `tauri-action`

The release remains a **draft** so maintainers can smoke-test the downloaded assets before publishing.

### 3. Release Desktop Electron

`Release Desktop Electron` is dispatched by `Prepare Release` with the release tag `v0.1.0` and can also be rerun manually with the same tag if needed.

It:

- validates that the checked-out repo state matches the tag version
- verifies that the draft GitHub release already exists
- lints, typechecks, and tests the Electron workspace
- builds Electron assets for:
  - Linux x64
  - macOS Apple Silicon
  - macOS Intel
  - Windows x64
- signs and notarizes macOS Electron assets
- uploads Electron release assets to the draft GitHub release

Windows and Linux Electron assets are experimental. They are included to gather feedback and platform evidence, but they are not yet considered stable release channels.

### 4. Publish MCP Package

`Publish MCP Package` is dispatched by `Prepare Release` with the release tag `v0.1.0` and can also be rerun manually with the same tag if needed.

It:

- validates that `packages/openducktor-mcp/package.json` matches the tag version
- verifies the MCP package
- publishes `@openducktor/mcp` to npmjs

### 5. Publish Web Package

`@openducktor/web` is the npm-facing local browser runner. It is intentionally separate from the desktop bundle: the package starts a loopback-only TypeScript host backend, waits for readiness, serves the built web frontend, and shuts the host down with a control-token-protected `/shutdown` request.

`Publish Web Package` is dispatched by `Prepare Release` with the release tag `v0.1.0` and can also be rerun manually with the same tag if needed.

It:

- builds the self-contained `@openducktor/web` package, including the static web frontend and TypeScript host backend
- verifies package contents with `scripts/prepare-web-publish-packages.ts`
- runs `npm publish --dry-run` for `@openducktor/web`
- publishes `@openducktor/web`

Development mode (`bun run browser:dev`) uses the same launcher in workspace mode and serves the repo-local frontend with Vite. Published installs serve the built frontend and TypeScript host backend from the `@openducktor/web` package and do not require publishing internal workspace packages.

### 6. Publish Homebrew Tap

`Publish Homebrew Tap` runs when a GitHub release is published and can also be rerun manually with the same tag if needed.

It:

- verifies that the GitHub release exists and is no longer a draft
- rejects prereleases so the tap only tracks stable published desktop releases
- downloads the signed macOS arm64 and Intel DMG assets from that release
- computes SHA-256 checksums for both assets
- renders `Casks/openducktor.rb` from repo metadata plus the published asset names and checksums
- commits and pushes the cask update to the configured Homebrew tap repository

The tap workflow is intentionally separate from desktop artifact workflows because the release draft remains private to maintainers until smoke testing is complete. Homebrew should only point at the final published GitHub release.

## Why this design

OpenDucktor currently has two desktop release paths.

The legacy Tauri path uses a CEF-specific flow:

- `bun run tauri:setup:cef`
- repo-specific path resolution from `apps/desktop/scripts/cef-paths.ts`

Those scripts pin `cargo-tauri` to the exact Tauri `feat/cef` revision locked in `apps/desktop/src-tauri/Cargo.lock`, export CEF into the shared OpenDucktor cache, and clear the downloaded bundle's macOS quarantine bit.

The Tauri release workflow keeps those OpenDucktor-specific setup steps, then hands the actual desktop build/upload to `tauri-action`. That gives you a more standard Tauri publish layer without throwing away the CEF bootstrap the repo already depends on.

The Electron path is the cross-platform migration path. It builds through `electron-builder`, uses `apps/electron/electron-builder.yml`, packages the MCP sidecar under app resources, and publishes macOS, Windows, and Linux artifacts to the same draft release. macOS Electron assets require signing and notarization; Windows and Linux assets are experimental.

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
- Certificate import is handled by `apple-actions/import-codesign-certs`.
- Desktop releases are now signed-only; the workflow fails fast if any Apple release secret is missing.

### MCP publish secrets

- None. MCP publishing uses npm Trusted Publisher via GitHub Actions OIDC.

### Homebrew tap secret

- `HOMEBREW_TAP_TOKEN`

Notes:

- The token must be able to push to the Homebrew tap repository.
- By default the workflow targets `${owner}/homebrew-openducktor` on branch `main`.
- You can override those defaults with repository variables:
  - `HOMEBREW_TAP_REPOSITORY`
  - `HOMEBREW_TAP_BRANCH`

### Release automation secret

- `RELEASE_AUTOMATION_TOKEN`

`Prepare Release` requires this token and refuses to push with the default GitHub Actions token. That keeps release automation aligned with normal repository protection and review expectations.

## How versioning works

The repo still uses a small helper script to keep version sources aligned, but the workflow owns when it runs.

The version sync touches:

- root `package.json`
- workspace package manifests discovered from the root `workspaces` configuration
- `apps/electron/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml` (`[package]` and `[workspace.package]`)
- `apps/desktop/src-tauri/Cargo.lock`
- `bun.lock`

The helper script remains useful because this repo spans three version domains:

- Bun workspace package manifests
- Electron package metadata
- Tauri config
- Cargo workspace/root package metadata

## Recommended release sequence

1. Open GitHub Actions.
2. Run `Prepare Release`.
3. Enter the target version, for example `0.1.0`.
4. Wait for `Prepare Release` to finish creating the version bump commit, release tag, draft GitHub release, and explicit downstream workflow dispatch.
5. Wait for `Release Desktop Tauri` to finish uploading macOS Tauri assets.
6. Wait for `Release Desktop Electron` to finish uploading Electron assets.
7. Wait for `Publish MCP Package` to finish publishing `@openducktor/mcp`.
8. Wait for `Publish Web Package` to finish publishing `@openducktor/web`.
9. Open the draft GitHub release and smoke-test the desktop assets. Treat Windows and Linux Electron assets as experimental and collect feedback before calling them stable.
10. Publish the draft release when the assets and notes look correct.
11. Wait for `Publish Homebrew Tap` to finish updating `Casks/openducktor.rb` in the tap repository.

## Homebrew tap setup

Before the first Homebrew release, create the tap repository and grant the workflow push access.

Recommended defaults:

- repository: `homebrew-openducktor`
- path: `Casks/openducktor.rb`
- default branch: `main`

Once the tap exists and the workflow is configured, users can install OpenDucktor with:

```sh
brew tap Maxsky5/openducktor
brew install --cask openducktor
```

## Asset policy for the first release line

OpenDucktor is currently macOS-first. The Tauri desktop workflow publishes macOS artifacts only. The Electron workflow also publishes Windows and Linux artifacts, but those builds are experimental and should be labeled and treated accordingly until platform support is proven stable.

The workflow does **not** generate a public updater channel yet. That should wait until the in-app updater flow is explicitly wired and tested. The current release pipeline is focused on reliable GitHub Releases distribution first, plus npm publishing for `@openducktor/mcp` and the local web runner package.

Homebrew distribution also stays GitHub Releases based. The cask generator fails if the desktop asset naming stops being architecture-derivable, so maintainers update the generator at the same time the bundle naming changes instead of silently publishing a broken cask.
