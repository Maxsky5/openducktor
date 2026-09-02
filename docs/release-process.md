# Desktop, web, and MCP release process

GitHub Actions creates OpenDucktor releases. A maintainer starts `Prepare Release`. The workflows create the commit, tag, draft, packages, and desktop files.

## Workflows

- `.github/workflows/release-prep.yml`
- `.github/workflows/release-desktop-electron.yml`
- `.github/workflows/publish-mcp.yml`
- `.github/workflows/publish-web.yml`
- `.github/workflows/publish-homebrew-tap.yml`

## Prepare a release

Start `Prepare Release` with `workflow_dispatch`. Set `version` and `release_channel`. Use `stable` for a normal semver version such as `0.4.0`. Use `beta` for a prerelease such as `0.4.0-beta.1`.

The workflow:

1. Checks the version and channel.
2. Updates package manifests and `bun.lock`.
3. Creates and pushes the release commit and tag.
4. Creates a draft GitHub release with generated notes. A beta is a GitHub prerelease.
5. Starts the Electron, MCP, and web workflows after the draft exists.
6. Sends the npm tag `latest` for stable or `beta` for beta.

For a beta, npm packages keep the full prerelease version. The Electron repository manifest uses the numeric base version. The packaged app and updater use the full prerelease version so the updater can compare beta builds.

## Build the desktop app

`Release Desktop Electron` gets the tag from `Prepare Release`. A maintainer can rerun it with the same tag.

The workflow checks the tag version and draft release. It lints, typechecks, and tests the Electron workspace. It builds Linux x64, macOS arm64, macOS x64, and Windows x64 files.

It signs and notarizes macOS files, packages the MCP sidecar, creates updater metadata, and uploads all files to the draft. It merges the two macOS manifests into `latest-mac.yml` or `beta-mac.yml`.

Windows and Linux files are experimental. Do not call them stable release channels.

## Publish MCP

`Publish MCP Package` checks that `packages/openducktor-mcp/package.json` matches the tag. It checks the npm tag, verifies the package, and publishes `@openducktor/mcp` to npmjs.

## Publish web

`@openducktor/web` starts a loopback TypeScript host, waits for it, serves the built frontend, and stops the host through the protected `/shutdown` route.

`Publish Web Package` builds the standalone package, runs `scripts/prepare-web-publish-packages.ts`, runs `npm publish --dry-run`, checks the npm tag, and publishes the package.

`bun run browser:dev` uses the same launcher in workspace mode with Vite. A published install contains the frontend and host. It does not need published internal workspace packages.

## Publish Homebrew

`Publish Homebrew Tap` starts after a GitHub release becomes public. A maintainer can rerun it with the same tag.

The workflow rejects a draft or prerelease. It downloads the signed arm64 and x64 DMG files, calculates SHA-256 values, writes `Casks/openducktor.rb`, then commits and pushes the cask to the tap.

This workflow starts after the draft becomes public so Homebrew never points to a private or untested release.

## Release notes

`.github/release.yml` defines categories. `Prepare Release` creates notes with `--generate-notes`. Review and edit the draft before publication.

## GitHub secrets

### Desktop

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_CERTIFICATE` is a base64 Developer ID Application `.p12`. The desktop workflow stops if an Apple secret is missing. macOS releases are signed but do not use a separate unsigned path.

### MCP and web

MCP and web use npm Trusted Publisher with GitHub Actions OIDC. They do not need an npm secret.

### Homebrew

`HOMEBREW_TAP_TOKEN` must be able to push to the tap repository. The default target is `${owner}/homebrew-openducktor` on `main`. `HOMEBREW_TAP_REPOSITORY` and `HOMEBREW_TAP_BRANCH` can replace these defaults.

### Release automation

`RELEASE_AUTOMATION_TOKEN` pushes the release commit and tag. The workflow rejects the default GitHub Actions token. The desktop workflow also uses this token to read the draft and upload files.

## Version sources

`scripts/release-version.ts` updates the root `package.json`, workspace package manifests, `apps/electron/package.json`, and `bun.lock`.

Stable releases use one version. Beta releases use:

| Source | Example |
|---|---|
| Root, internal packages, MCP, and web | `0.4.0-beta.1` |
| Electron repository manifest | `0.4.0` |
| Packaged app and updater metadata | `0.4.0-beta.1` with a numeric OS short version |
| Git tag | `v0.4.0-beta.1` |

## Release steps

1. Open GitHub Actions and run `Prepare Release`.
2. Enter the version and select `stable` or `beta`.
3. Wait for `Prepare Release` to create the commit, tag, draft, and downstream runs.
4. Wait for desktop, MCP, and web workflows to finish.
5. Open the draft. Check notes and every expected desktop file. Mark Windows and Linux as experimental.
6. Publish the draft.
7. For a stable release, wait for the Homebrew workflow to update `Casks/openducktor.rb`.

After a beta, check that `latest` still points to the last stable package:

```sh
npm dist-tag ls @openducktor/web
npm dist-tag ls @openducktor/mcp
```

The new version must appear under `beta`.

## First Homebrew setup

Create `homebrew-openducktor` with `Casks/openducktor.rb` on `main`. Give the workflow token push access.

Users install the cask with:

```sh
brew install --cask Maxsky5/openducktor/openducktor
```

The full cask name grants trust only to this cask. A user who already installed the tap can run `brew trust --cask Maxsky5/openducktor/openducktor` once, then use `brew install --cask openducktor`.

## Desktop file policy

OpenDucktor supports macOS first. Stable builds use the `latest` updater channel. A beta uses its first prerelease name, so `0.4.0-beta.1` uses `beta`.

Each desktop release needs:

- Installers for each shipped platform. These include macOS DMG and ZIP, Windows NSIS and ZIP, and Linux AppImage and DEB.
- Electron Builder metadata. Stable releases need `latest.yml`, `latest-mac.yml`, and `latest-linux.yml`. Beta releases need the same files with the `beta` prefix.
- Each `*.blockmap` that Electron Builder creates.

The workflow stops if required metadata is missing. The publish job merges arm64 and x64 macOS metadata before upload.

The Homebrew cask uses GitHub Release files. If desktop file names change, update the cask generator in the same change. The generator stops when it cannot derive the architecture from a file name.
