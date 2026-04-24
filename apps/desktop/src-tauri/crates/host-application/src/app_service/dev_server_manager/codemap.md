# apps/desktop/src-tauri/crates/host-application/src/app_service/dev_server_manager/

## Responsibility
Manage task-scoped dev server groups and their process state.

## Design
State, process, and terminal submodules keep process tracking, group snapshots, and buffered output separate while sharing one `AppService` entrypoint.

## Flow
The service loads repo config, validates hook trust, starts/stops/restarts each script, and emits group snapshots as terminal/process state changes.

## Integration
Uses `host_domain::DevServerGroupState`, the workspace config store, and dev-server emitters used by the browser/desktop UI.
