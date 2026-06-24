# Desktop, Web, and MCP Release Process

OpenDucktor releases are owned by GitHub Actions. Maintainers do not need to run local release commands or create tags by hand.

## Workflow Layout

The release flow is split into these workflows:

- `.github/workflows/release-prep.yml`
- `.github/workflows/release-desktop-electron.yml`
- `.github/workflows/publish-mcp.yml`
- `.github/workflows/publish-web.yml`
- `.github/workflows/publish-homebrew-tap.yml`

## Prepare Release

`Prepare Release` is the only workflow a maintainer starts manually.

- Trigger: `workflow_dispatch`
- Input: `version` like `0.1.0`
- Input: `release_channel`, either `stable` or `beta`

It does all release preparation work:

- validates the requested version
- validates that stable releases use normal semver and beta releases use prerelease semver, for example `0.4.0-beta.1`
- updates repo version manifests
- refreshes `bun.lock`
- creates the release bump commit on the default branch
- creates the release tag
- creates the draft GitHub release with generated notes after the commit and tag are pushed, marking beta releases as GitHub prereleases
- dispatches the Electron desktop, MCP, and web publish workflows explicitly after the draft exists
- passes the npm dist-tag to the web and MCP publish workflows:
  - `stable` publishes npm packages with `latest`
  - `beta` publishes npm packages with `beta`

For beta releases, npm-facing packages keep the full prerelease version, for example `0.4.0-beta.1`. Electron desktop package metadata uses the numeric base version, for example `0.4.0`.

## Release Desktop Electron

`Release Desktop Electron` is dispatched by `Prepare Release` with the release tag and can also be rerun manually with the same tag if needed.

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
- packages the MCP sidecar under app resources
- uploads Electron release assets to the draft GitHub release

Windows and Linux Electron assets are experimental. They are included to gather feedback and platform evidence, but they are not yet considered stable release channels.

## Publish MCP Package

`Publish MCP Package` is dispatched by `Prepare Release` with the release tag and can also be rerun manually with the same tag if needed.

It:

- validates that `packages/openducktor-mcp/package.json` matches the tag version
- validates that prerelease tags are published to npm `beta` and stable tags are published to npm `latest`
- verifies the MCP package
- publishes `@openducktor/mcp` to npmjs with the requested dist-tag

## Publish Web Package

`@openducktor/web` is the npm-facing local browser runner. It is intentionally separate from the desktop bundle: the package starts a loopback-only TypeScript host backend, waits for readiness, serves the built web frontend, and shuts the host down with a control-token-protected `/shutdown` request.

`Publish Web Package` is dispatched by `Prepare Release` with the release tag and can also be rerun manually with the same tag if needed.

It:

- builds the self-contained `@openducktor/web` package, including the static web frontend and TypeScript host backend
- verifies package contents with `scripts/prepare-web-publish-packages.ts`
- runs `npm publish --dry-run` for `@openducktor/web`
- validates that prerelease tags are published to npm `beta` and stable tags are published to npm `latest`
- publishes `@openducktor/web` with the requested dist-tag

Development mode (`bun run browser:dev`) uses the same launcher in workspace mode and serves the repo-local frontend with Vite. Published installs serve the built frontend and TypeScript host backend from the `@openducktor/web` package and do not require publishing internal workspace packages.

## Publish Homebrew Tap

`Publish Homebrew Tap` runs when a GitHub release is published and can also be rerun manually with the same tag if needed.

It:

- verifies that the GitHub release exists and is no longer a draft
- rejects prereleases so the tap only tracks stable published desktop releases
- downloads the signed macOS arm64 and Intel DMG assets from that release
- computes SHA-256 checksums for both assets
- renders `Casks/openducktor.rb` from Electron metadata plus the published asset names and checksums
- commits and pushes the cask update to the configured Homebrew tap repository

The tap workflow is intentionally separate from desktop artifact workflows because the release draft remains private to maintainers until smoke testing is complete. Homebrew should only point at the final published GitHub release.

## Release Notes

Desktop release notes use **GitHub-generated release notes**.

- `.github/release.yml` defines the category mapping
- the draft GitHub release is created with `--generate-notes`
- maintainers can review and edit the draft notes before publishing

## Required GitHub Secrets

### Desktop Release Secrets

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

Notes:

- `APPLE_CERTIFICATE` must be a base64-encoded `.p12` signing certificate.
- Desktop releases are signed-only; the workflow fails fast if any Apple release secret is missing.

### MCP Publish Secrets

- None. MCP publishing uses npm Trusted Publisher via GitHub Actions OIDC.

### Homebrew Tap Secret

- `HOMEBREW_TAP_TOKEN`

Notes:

- The token must be able to push to the Homebrew tap repository.
- By default the workflow targets `${owner}/homebrew-openducktor` on branch `main`.
- You can override those defaults with repository variables:
  - `HOMEBREW_TAP_REPOSITORY`
  - `HOMEBREW_TAP_BRANCH`

### Release Automation Secret

- `RELEASE_AUTOMATION_TOKEN`

`Prepare Release` requires this token and refuses to push with the default GitHub Actions token. `Release Desktop Electron` uses the same token to read the draft GitHub release and upload desktop assets to it. That keeps release automation aligned with normal repository protection and review expectations.

## How Versioning Works

The repo uses `scripts/release-version.ts` to keep version sources aligned.

The version sync touches:

- root `package.json`
- workspace package manifests discovered from the root `workspaces` configuration
- `apps/electron/package.json`
- `bun.lock`

Stable releases use the same version everywhere. Beta releases split the version domains deliberately:

- root, internal packages, `@openducktor/mcp`, and `@openducktor/web`: full prerelease version, for example `0.4.0-beta.1`
- Electron desktop package metadata: numeric desktop bundle version, for example `0.4.0`

The GitHub release tag remains the full release tag, for example `v0.4.0-beta.1`.

## Recommended Release Sequence

1. Open GitHub Actions.
2. Run `Prepare Release`.
3. Enter the target version, for example `0.1.0`.
4. Select `stable` or `beta` for `release_channel`. Use a prerelease version such as `0.4.0-beta.1` for beta.
5. Wait for `Prepare Release` to finish creating the version bump commit, release tag, draft GitHub release, and explicit downstream workflow dispatch.
6. Wait for `Release Desktop Electron` to finish uploading Electron assets.
7. Wait for `Publish MCP Package` to finish publishing `@openducktor/mcp`.
8. Wait for `Publish Web Package` to finish publishing `@openducktor/web`.
9. Open the draft GitHub release and review the desktop assets and notes. Treat Windows and Linux assets as experimental and collect feedback before calling them stable.
10. Publish the draft release when the assets and notes look correct.
11. For stable releases, wait for `Publish Homebrew Tap` to finish updating `Casks/openducktor.rb` in the tap repository. Beta releases are prereleases and are intentionally rejected by the Homebrew tap workflow.

After a beta publish, verify that npm kept `latest` on the last stable version:

```sh
npm dist-tag ls @openducktor/web
npm dist-tag ls @openducktor/mcp
```

The beta version should appear under `beta`; `latest` should still point to the latest stable version.

## Homebrew Tap Setup

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

## Asset Policy

OpenDucktor is currently macOS-first. The Electron workflow publishes macOS, Windows, and Linux artifacts, but Windows and Linux builds are experimental and should be labeled and treated accordingly until platform support is proven stable.

The workflow does **not** generate a public updater channel yet. That should wait until the in-app updater flow is explicitly wired and tested. The current release pipeline is focused on reliable GitHub Releases distribution first, plus npm publishing for `@openducktor/mcp` and the local web runner package.

Homebrew distribution also stays GitHub Releases based. The cask generator fails if the desktop asset naming stops being architecture-derivable, so maintainers update the generator at the same time the bundle naming changes instead of silently publishing a broken cask.
