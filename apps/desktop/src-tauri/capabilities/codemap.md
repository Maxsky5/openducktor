# apps/desktop/src-tauri/capabilities/

## Responsibility
Tauri capability manifests for the desktop host window and command surface.

## Design
`default.json` is the main capability bundle for the `main` window and keeps permissions minimal (`core:default`, `dialog:allow-open`). The manifest stays static and only describes host permissions; runtime behavior lives in Rust services.

## Flow
Tauri loads the capability manifest at build/runtime to decide which windows and permissions the host app receives before any command handler runs.

## Integration
Controls command access for the Tauri desktop shell and is consumed by the host app configuration, not by runtime services or runtime registry logic.
