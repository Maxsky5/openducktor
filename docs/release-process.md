# Desktop, mobile, web, and MCP release process

GitHub Actions creates OpenDucktor releases. A maintainer starts `Prepare Release`. The workflows create the commit, tag, draft, packages, and desktop files.

## Workflows

- `.github/workflows/release-prep.yml`
- `.github/workflows/release-desktop-electron.yml`
- `.github/workflows/release-mobile.yml`
- `.github/workflows/publish-mcp.yml`
- `.github/workflows/publish-web.yml`
- `.github/workflows/publish-homebrew-tap.yml`
- `.github/workflows/deploy-web-client.yml`

## Prepare a release

Start `Prepare Release` with `workflow_dispatch`. Set `version` and `release_channel`. Use `stable` for a normal semver version such as `0.4.0`. Use `beta` for a prerelease such as `0.4.0-beta.1`.

The workflow:

1. Checks the version and channel.
2. Updates package manifests and `bun.lock`.
3. Creates and pushes the release commit and tag.
4. Creates a draft GitHub release with generated notes. A beta is a GitHub prerelease.
5. Starts the Electron, mobile, MCP, and web workflows after the draft exists.
6. Sends the npm tag `latest` for stable or `beta` for beta.

For a beta, npm packages keep the full prerelease version. The Electron and mobile repository manifests use the numeric base version. The packaged app and updater use the full prerelease version so the updater can compare beta builds.

## Build the desktop app

`Release Desktop Electron` gets the tag from `Prepare Release`. A maintainer can rerun it with the same tag.

The workflow checks that the checked-out repository version matches the selected tag and draft release. It lints, typechecks, and tests the Electron workspace. It builds Linux x64, macOS arm64, macOS x64, and Windows x64 files.

It signs and notarizes macOS files, packages the MCP sidecar, creates updater metadata, and uploads all files to the draft. It merges the two macOS manifests into `latest-mac.yml` or `beta-mac.yml`.

The package build checks that the selected platform and architecture match the host before it removes old output. It compiles the MCP sidecar for that target. It starts the packaged executable. It completes MCP initialization against a local test bridge. It also checks the packaged Claude file search module.

## Build the mobile app

`Prepare Release` starts `Release Mobile` with the tag. A maintainer can run it again with the same tag. Each run gets a higher store build number.

The iOS job archives a signed build and uploads it to TestFlight. The Android job builds a signed App Bundle and uploads it to the Google Play internal track. A missing or incorrect secret stops the step that uses it.

Public store release stays manual. After the device checks, promote the builds in App Store Connect and Google Play Console. Read [the mobile app release](../apps/mobile/README.md#release) for the first setup of the store records.

## Publish MCP

`Publish MCP Package` checks that `packages/openducktor-mcp/package.json` matches the tag. It checks the npm tag, verifies the package, and publishes `@openducktor/mcp` to npmjs.

## Publish web

`@openducktor/web` starts a loopback TypeScript host, waits for it, serves the built frontend, and stops the host through the protected `/shutdown` route.

`Publish Web Package` builds the standalone package, runs `scripts/prepare-web-publish-packages.ts`, runs `npm publish --dry-run`, checks the npm tag, and publishes the package.

`bun run browser:dev` uses the same launcher in workspace mode with Vite. A published install contains the frontend and host. It does not need published internal workspace packages.

### Chrome for Testing pin

The web runner downloads one pinned Chrome for Testing version. `packages/host/src/adapters/browser/chrome-for-testing/chrome-for-testing-pin.ts` holds the version and the byte size and SHA-256 of each platform archive. A new version makes each host download the browser again.

To update the pin:

1. Pick the Stable version from `https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json`.
2. Download the full `chrome` archive of each platform in the pin file once. Write its byte size and SHA-256 into the pin file. The JSON has no checksum.
3. Copy `chrome-linux64/deb.deps` into `CHROME_FOR_TESTING_DEBIAN_PACKAGES`.
4. Run `bun run --filter @openducktor/host test:browser-conformance`. It installs the new version with the real installer and runs the engine conformance checks.

## Publish Homebrew

`Publish Homebrew Tap` starts after a GitHub release becomes public. A maintainer can rerun it with the same tag.

The workflow rejects a draft or prerelease. It downloads the signed arm64 and x64 DMG files, calculates SHA-256 values, writes `Casks/openducktor.rb`, then commits and pushes the cask to the tap.

This workflow starts after the draft becomes public so Homebrew never points to a private or untested release.

## Update the website

The website header shows the latest public stable release. The `Marketing website` workflow starts when a stable release becomes public, builds `main`, and publishes the new version of the header. A beta does not change the website.

## Deploy the web client

`https://app.openducktor.dev` serves the standalone web client of the release that GitHub marks as Latest. The marketing website shows the same release. When a stable release becomes public, `Deploy Web Client` builds the client from the release tag and deploys it to the Cloudflare Worker `openducktor-web-client`. A beta does not change the site.

The workflow checks that the package versions match the tag. Just before the upload, it checks that the release is still GitHub's latest release. If it is not, the workflow deploys nothing and gives the reason in the run summary.

When you publish an older release, such as a `v0.9.5` backport after `v1.0.0`, clear "Set as the latest release". The site then keeps the newer client.

If a check or the upload fails, the site keeps its earlier client. The workflow has no manual start. To retry, re-run the jobs of the failed run.

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

### Mobile

- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE` and `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`: a base64 Apple Distribution `.p12` and its password.
- `IOS_PROVISIONING_PROFILE`: a base64 App Store provisioning profile for `com.openducktor.mobile`.
- `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`, and `APP_STORE_CONNECT_API_KEY`: the App Store Connect API key for the TestFlight upload.
- `ANDROID_UPLOAD_KEYSTORE`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, and `ANDROID_UPLOAD_KEY_PASSWORD`: the base64 upload keystore and its values.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: a service account with release access to the app.

### MCP and web

MCP and web use npm Trusted Publisher with GitHub Actions OIDC. They do not need an npm secret.

### Homebrew

`HOMEBREW_TAP_TOKEN` must be able to push to the tap repository. The default target is `${owner}/homebrew-openducktor` on `main`. `HOMEBREW_TAP_REPOSITORY` and `HOMEBREW_TAP_BRANCH` can replace these defaults.

### Release automation

`RELEASE_AUTOMATION_TOKEN` pushes the release commit and tag. The workflow rejects the default GitHub Actions token. The desktop workflow also uses this token to read the draft and upload files.

## Version sources

`scripts/release-version.ts` updates the root `package.json`, workspace package manifests, `apps/electron/package.json`, `apps/mobile/package.json`, and `bun.lock`.

Stable releases use one version. Beta releases use:

| Source | Example |
|---|---|
| Root, internal packages, MCP, and web | `0.4.0-beta.1` |
| Electron and mobile repository manifests | `0.4.0` |
| Mobile store builds | `0.4.0` with a build number that always increases |
| Packaged app and updater metadata | `0.4.0-beta.1` with a numeric OS short version |
| Git tag | `v0.4.0-beta.1` |

## Release steps

1. Open GitHub Actions and run `Prepare Release`.
2. Enter the version and select `stable` or `beta`.
3. Wait for `Prepare Release` to create the commit, tag, draft, and downstream runs.
4. Wait for desktop, mobile, MCP, and web workflows to finish.
5. Open the draft. Check notes and every expected desktop file.
6. Publish the draft.
7. For a stable release, wait for the Homebrew workflow to update `Casks/openducktor.rb`.
8. For a stable release, check the `Deploy Web Client` run summary.

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

Stable builds use the `latest` updater channel. A beta uses its first prerelease name, so `0.4.0-beta.1` uses `beta`.

Each desktop release needs:

- Installers for each shipped platform. These include macOS DMG and ZIP, Windows NSIS and ZIP, and Linux AppImage and DEB.
- Electron Builder metadata. Stable releases need `latest.yml`, `latest-mac.yml`, and `latest-linux.yml`. Beta releases need the same files with the `beta` prefix.
- Each `*.blockmap` that Electron Builder creates.

The workflow stops if required metadata is missing. The publish job merges arm64 and x64 macOS metadata before upload.

The Homebrew cask uses GitHub Release files. If desktop file names change, update the cask generator in the same change. The generator stops when it cannot derive the architecture from a file name.
