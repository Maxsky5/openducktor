#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

if [[ -z "${CEF_PATH:-}" || -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  exit 0
fi

# Expects CWD = apps/desktop, set by tauri.conf.json beforeBundleCommand.
target_root="${CARGO_TARGET_DIR:-src-tauri/target}"
release_root="${target_root}/release"
entitlements_path="src-tauri/entitlements/macos-cef-helper.plist"

if [[ -n "${OPENDUCKTOR_TAURI_TARGET:-}" ]]; then
  release_root="${target_root}/${OPENDUCKTOR_TAURI_TARGET}/release"
fi

if [[ ! -f "$entitlements_path" ]]; then
  echo "macOS CEF helper entitlements file was not found at $entitlements_path" >&2
  exit 1
fi

sign_binary() {
  local binary_name="$1"
  shift
  local binary_path="${release_root}/${binary_name}"

  if [[ ! -f "$binary_path" ]]; then
    echo "macOS CEF signing is active, but $binary_name was not found at $binary_path" >&2
    echo "Build the app first, or set OPENDUCKTOR_TAURI_TARGET to the Cargo target triple used by Tauri build." >&2
    exit 1
  fi

  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --options runtime --timestamp "$@" "$binary_path"
  codesign --verify --verbose=4 "$binary_path"
}

sign_binary openducktor-desktop-helper --entitlements "$entitlements_path"
sign_binary openducktor-web-host
