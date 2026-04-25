#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CEF_PATH:-}" || -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  exit 0
fi

helper_path="src-tauri/target/release/openducktor-desktop-helper"

if [[ -n "${OPENDUCKTOR_TAURI_TARGET:-}" ]]; then
  helper_path="src-tauri/target/${OPENDUCKTOR_TAURI_TARGET}/release/openducktor-desktop-helper"
fi

if [[ ! -f "$helper_path" ]]; then
  echo "macOS CEF helper signing is active, but openducktor-desktop-helper was not found at $helper_path" >&2
  echo "Build the app first, or set OPENDUCKTOR_TAURI_TARGET to the Cargo target triple used by Tauri build." >&2
  exit 1
fi

codesign --force --sign "$APPLE_SIGNING_IDENTITY" --options runtime --timestamp "$helper_path"
codesign --verify --verbose=4 "$helper_path"
