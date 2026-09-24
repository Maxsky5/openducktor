# Electron MSAL package size

## Package change

Electron Builder excludes the native broker files under `@azure/msal-node-runtime/dist/linux`, `dist/macos`, and `dist/windows`. OpenDucktor does not use the broker. It keeps the runtime JavaScript module, MSAL persistence, keytar, and DPAPI files.

The package build starts the packaged Electron executable in Node mode. It checks the runtime file list in `app.asar` and `app.asar.unpacked`, loads MSAL persistence through CommonJS and ESM, loads keytar on macOS and Linux, and loads DPAPI on Windows. A returned broker binary or a missing storage file fails the package build.

## macOS Apple Silicon size

Both unsigned local DMGs came from the same source commit and lockfile on a macOS Apple Silicon host. The first build used the prior `electron-builder.yml` rules. The second build used the new exclusion rules. Each build used `bun run --filter @openducktor/electron package --platform macos --arch arm64`.

| Item | Before, bytes | After, bytes | Decrease, bytes |
| --- | ---: | ---: | ---: |
| `app.asar.unpacked` | 48,498,939 | 14,161,145 | 34,337,794 |
| `OpenDucktor.app` | 448,535,805 | 414,213,721 | 34,322,084 |
| DMG | 176,184,171 | 165,475,716 | 10,708,455 |

Directory sizes sum the logical sizes of regular files and omit symlinks. The DMG size is its file size. The old package held 34,337,794 bytes of `@azure/msal-node-runtime` files in `app.asar.unpacked`. The new package has no native broker files there or in `app.asar`.

## Verification limits

The local macOS build loaded MSAL persistence and keytar from the packaged app. The same check passed for an app copied from the DMG. A packaged `KeychainPersistence` saved, read, and deleted a dummy value. The package kept the three MSAL extension DPAPI files in `app.asar.unpacked`.

A Windows build must load DPAPI on Windows, and a Linux build must load keytar on Linux. Those platform checks did not run on this Mac.

The app copied from the DMG reached onboarding with a clean profile and no visible credential prompt. The package check does not call the Azure DevOps connection flow. Azure DevOps PAT save, read, and disconnect through that flow, Entra device sign-in, token reuse after restart, and disconnect need credentialed desktop runs. No credentialed Azure DevOps account was available for this build.
