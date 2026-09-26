# Install OpenDucktor

## Desktop scripts

The scripts install the latest stable GitHub release for the current user. They select the desktop file for your system and processor, check its SHA-256 digest against the GitHub release, and report success after installation ends.

### macOS arm64, macOS x64, or Linux x64

```sh
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/Maxsky5/openducktor/main/install.sh | sh'
```

The shell script needs Bash, `curl`, and Python 3. It also uses `shasum` on macOS or `sha256sum` on Linux.

### Windows x64

Run this command in Windows PowerShell 5.1 or PowerShell 7:

```powershell
irm https://raw.githubusercontent.com/Maxsky5/openducktor/main/install.ps1 | iex
```

The Windows script runs the NSIS installer for the current user and checks its result. The scripts do not turn off operating system trust checks.

### Install paths

| System | App path |
| --- | --- |
| macOS | `~/Applications/OpenDucktor.app` |
| Linux | `~/.local/bin/OpenDucktor.AppImage` |
| Windows | `$env:LOCALAPPDATA\Programs\OpenDucktor\OpenDucktor.exe` |

On Linux, the script adds a launcher at `~/.local/share/applications/openducktor.desktop` and an icon at `~/.local/share/icons/openducktor.png`. The app stays an AppImage so its updater can use it. On Windows, NSIS adds shortcuts.

### Updates

Quit OpenDucktor and run the same script again to update an install that the script manages. The scripts stop if Homebrew, a system package, or another installer manages the app. Use that installer's update method instead.

The scripts check the download before they change an installed app. If installation fails, they keep or restore the prior app and report what you need to fix.

## Homebrew on macOS

```sh
brew install --cask Maxsky5/openducktor/openducktor
```

Homebrew requires explicit trust for non-official taps. This command trusts only the OpenDucktor cask. If you already added the tap and want the short name, run `brew trust --cask Maxsky5/openducktor/openducktor` once, then run `brew install --cask openducktor`.

Homebrew installs the signed and notarized macOS app from GitHub Releases.

## Manual download

1. Open [GitHub Releases](https://github.com/Maxsky5/openducktor/releases).
2. Download the latest desktop file for your system and processor.
3. Install the app, launch it, and open the local repository you want to work on.

Windows and Linux desktop builds are experimental. To report a problem, include your system, logs, and the action that failed.

## Browser runner

The browser runner needs Node.js 24.14 or later. Run:

```sh
npx @openducktor/web
```

The runner opens OpenDucktor in your browser.
