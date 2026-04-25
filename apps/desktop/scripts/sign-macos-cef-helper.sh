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
helper_path="${target_root}/release/openducktor-desktop-helper"
entitlements_path="src-tauri/entitlements/macos-cef-helper.plist"

if [[ -n "${OPENDUCKTOR_TAURI_TARGET:-}" ]]; then
  helper_path="${target_root}/${OPENDUCKTOR_TAURI_TARGET}/release/openducktor-desktop-helper"
fi

if [[ ! -f "$helper_path" ]]; then
  echo "macOS CEF helper signing is active, but openducktor-desktop-helper was not found at $helper_path" >&2
  echo "Build the app first, or set OPENDUCKTOR_TAURI_TARGET to the Cargo target triple used by Tauri build." >&2
  exit 1
fi

if [[ ! -f "$entitlements_path" ]]; then
  echo "macOS CEF helper entitlements file was not found at $entitlements_path" >&2
  exit 1
fi

codesign --force --sign "$APPLE_SIGNING_IDENTITY" --options runtime --timestamp --entitlements "$entitlements_path" "$helper_path"
codesign --verify --verbose=4 "$helper_path"
