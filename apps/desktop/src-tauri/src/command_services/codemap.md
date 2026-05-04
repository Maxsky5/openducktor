# apps/desktop/src-tauri/src/command_services/

## Responsibility
Transport-agnostic command behavior shared by Tauri IPC wrappers and headless HTTP command wrappers.

## Design
Modules define neutral request structs, validation, authorization-sensitive request construction, service/GitPort invocation, and classified errors. They avoid Tauri `State`, Axum response types, HTTP token handling, and JSON envelopes.

## Flow
Transport wrappers deserialize/receive arguments, call command service functions inside the appropriate blocking runtime, then map `CommandServiceError` into the transport's response style.

## Integration
Depends on `AppService`, `host-domain` request/result types, and local host-shell helpers for command-boundary concerns such as git worktree authorization and snapshot metadata.
