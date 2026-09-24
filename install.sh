#!/bin/sh
set -eu
umask 077

error() {
  printf 'OpenDucktor install: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || error 'curl is required.'
command -v python3 >/dev/null 2>&1 || error 'Python 3 is required to read GitHub release metadata.'

os=$(uname -s)
arch=$(uname -m)
case "$os:$arch" in
  Darwin:arm64) target=mac-arm64.zip ;;
  Darwin:x86_64) target=mac-x64.zip ;;
  Linux:x86_64) target=linux-x86_64.AppImage ;;
  *) error "Unsupported system $os/$arch. Use macOS arm64 or x64, or Linux x64." ;;
esac

if [ "$os" = Darwin ]; then
  command -v shasum >/dev/null 2>&1 || error 'shasum is required.'
  install_dir="$HOME/Applications"
  installed="$install_dir/OpenDucktor.app"
  marker="$install_dir/.openducktor-script-install"
  [ ! -e /Applications/OpenDucktor.app ] || error 'An app exists in /Applications. Update it with its current installer or remove it before using this script.'
  for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$brew" ] && "$brew" list --cask --versions openducktor 2>/dev/null | grep -q .; then
      error 'Homebrew manages OpenDucktor. Run brew upgrade --cask openducktor instead.'
    fi
  done
  if command -v mdfind >/dev/null 2>&1; then
    mdfind 'kMDItemCFBundleIdentifier == "com.openducktor.app"' | while IFS= read -r app; do
      if [ -d "$app" ] && [ "$app" != "$installed" ]; then
        error "Another OpenDucktor app exists at $app. Update or remove it before using this script."
      fi
    done
  fi
else
  command -v sha256sum >/dev/null 2>&1 || error 'sha256sum is required.'
  install_dir="$HOME/.local/bin"
  installed="$install_dir/OpenDucktor.AppImage"
  marker="$HOME/.local/share/applications/.openducktor-script-install"
  desktop="$HOME/.local/share/applications/openducktor.desktop"
  [ ! -e /usr/share/applications/openducktor.desktop ] || error 'A system desktop install exists. Update it with its package manager before using this script.'
  [ ! -e /usr/local/share/applications/openducktor.desktop ] || error 'A system desktop install exists. Remove it before using this script.'
  if command -v openducktor >/dev/null 2>&1; then
    error 'Another openducktor executable is on PATH. Update or remove that install before using this script.'
  fi
  [ ! -e "$desktop" ] || [ -f "$marker" ] || error "An unmanaged desktop launcher exists at $desktop. Remove it before using this script."
fi

if [ -e "$installed" ] && [ ! -f "$marker" ]; then
  error "An unmanaged install exists at $installed. Update or remove it before using this script."
fi
[ ! -L "$installed" ] || error "The install path $installed is a symlink. Remove it before using this script."
if [ -f "$marker" ] && [ ! -e "$installed" ]; then
  error "The managed install at $installed is missing. Remove $marker after checking your installation."
fi
if [ "$os" = Darwin ]; then
  if pgrep -x OpenDucktor >/dev/null 2>&1; then
    error 'Quit OpenDucktor before updating it.'
  fi
elif [ -e "$installed" ] && pgrep -f "$installed" >/dev/null 2>&1; then
  error 'Quit OpenDucktor before updating it.'
fi
if [ "$os" = Linux ] && [ -L "$desktop" ]; then
  error "The desktop launcher $desktop is a symlink. Remove it before using this script."
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/openducktor-install.XXXXXXXX") || error 'Could not create a temporary directory.'
backup_app=
backup_desktop=
new_app=0
new_desktop=0
new_marker=0
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    [ "$new_marker" -eq 0 ] || rm -f "$marker"
    if [ -n "$backup_app" ] && [ -e "$backup_app" ]; then
      [ "$new_app" -eq 0 ] || rm -rf "$installed"
      mv "$backup_app" "$installed" || printf 'Restore the previous app from %s\n' "$backup_app" >&2
    elif [ "$new_app" -eq 1 ]; then
      rm -rf "$installed"
    fi
    if [ -n "$backup_desktop" ] && [ -e "$backup_desktop" ]; then
      [ "$new_desktop" -eq 0 ] || rm -f "$desktop"
      mv "$backup_desktop" "$desktop" || printf 'Restore the previous launcher from %s\n' "$backup_desktop" >&2
    elif [ "$new_desktop" -eq 1 ]; then
      rm -f "$desktop"
    fi
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

api=https://api.github.com/repos/Maxsky5/openducktor/releases/latest
curl -fsSL --proto '=https' -H 'Accept: application/vnd.github+json' -H 'User-Agent: OpenDucktor-installer' "$api" -o "$work/release.json" || error 'Could not load the latest stable GitHub release.'
python3 - "$work/release.json" "$target" > "$work/selection" <<'PY' || error 'The latest release has no single matching desktop asset with a SHA-256 digest.'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    release = json.load(source)
tag = release.get("tag_name", "")
if release.get("draft") or release.get("prerelease") or not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
    raise ValueError("The latest release is not a published stable version")
name = f"OpenDucktor-{tag[1:]}-{sys.argv[2]}"
assets = [asset for asset in release.get("assets", []) if asset.get("name") == name]
if len(assets) != 1:
    raise ValueError(f"Expected one release asset named {name}, found {len(assets)}")
asset = assets[0]
digest = asset.get("digest", "")
url = asset.get("browser_download_url", "")
expected_url = f"https://github.com/Maxsky5/openducktor/releases/download/{tag}/{name}"
if asset.get("state") != "uploaded" or not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", digest) or url != expected_url:
    raise ValueError(f"Release asset {name} has no valid uploaded file, digest, or URL")
print(url)
print(digest[7:].lower())
PY

asset_url=$(sed -n '1p' "$work/selection")
expected_sha=$(sed -n '2p' "$work/selection")
download="$work/asset"
curl -fsSL --proto '=https' "$asset_url" -o "$download" || error 'Could not download the desktop asset.'
if [ "$os" = Darwin ]; then
  actual_sha=$(shasum -a 256 "$download" | cut -d ' ' -f 1)
else
  actual_sha=$(sha256sum "$download" | cut -d ' ' -f 1)
fi
[ "$actual_sha" = "$expected_sha" ] || error 'The downloaded asset SHA-256 differs from the GitHub release digest. The existing install is unchanged.'

mkdir -p "$install_dir" || error "Could not create $install_dir."
if [ "$os" = Darwin ]; then
  mkdir "$work/unpacked"
  ditto -x -k "$download" "$work/unpacked" || error 'Could not extract the macOS app ZIP.'
  [ -d "$work/unpacked/OpenDucktor.app" ] || error 'The macOS ZIP has no OpenDucktor.app.'
  codesign --verify --deep --strict "$work/unpacked/OpenDucktor.app" || error 'The macOS app signature failed verification.'
  spctl --assess --type execute "$work/unpacked/OpenDucktor.app" || error 'macOS did not accept the app signature.'
  if [ -e "$installed" ]; then
    backup_app="$install_dir/.OpenDucktor.app.backup.$$"
    mv "$installed" "$backup_app" || error 'Could not move the previous app out of the way. Quit OpenDucktor and retry.'
  fi
  new_app=1
  mv "$work/unpacked/OpenDucktor.app" "$installed" || error 'Could not install the macOS app.'
  if [ ! -f "$marker" ]; then
    printf 'Installed by install.sh\n' > "$work/marker"
    new_marker=1
    mv "$work/marker" "$marker" || error 'Could not record the managed install.'
  fi
else
  mkdir -p "$(dirname "$desktop")" || error 'Could not create the desktop launcher directory.'
  cp "$download" "$work/OpenDucktor.AppImage" || error 'Could not stage the AppImage.'
  chmod 755 "$work/OpenDucktor.AppImage" || error 'Could not make the AppImage executable.'
  # Exec needs these characters escaped inside quotes.
  desktop_exec=$(printf '%s' "$installed" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g')
  printf '[Desktop Entry]\nType=Application\nName=OpenDucktor\nExec="%s"\nIcon=openducktor\nTerminal=false\nCategories=Development;\n' "$desktop_exec" > "$work/openducktor.desktop"
  if [ -e "$installed" ]; then
    backup_app="$install_dir/.OpenDucktor.AppImage.backup.$$"
    mv "$installed" "$backup_app" || error 'Could not move the previous AppImage out of the way.'
  fi
  if [ -e "$desktop" ]; then
    backup_desktop="$(dirname "$desktop")/.openducktor.desktop.backup.$$"
    mv "$desktop" "$backup_desktop" || error 'Could not move the previous desktop launcher out of the way.'
  fi
  new_app=1
  mv "$work/OpenDucktor.AppImage" "$installed" || error 'Could not install the AppImage.'
  new_desktop=1
  mv "$work/openducktor.desktop" "$desktop" || error 'Could not install the desktop launcher.'
  if [ ! -f "$marker" ]; then
    printf 'Installed by install.sh\n' > "$work/marker"
    new_marker=1
    mv "$work/marker" "$marker" || error 'Could not record the managed install.'
  fi
fi

rm -rf "$backup_app"
[ -z "$backup_desktop" ] || rm -f "$backup_desktop"
printf 'OpenDucktor is installed at %s\n' "$installed"
