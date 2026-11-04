# Host database

OpenDucktor stores shared workspace data and execution settings in `<config-root>/database.sqlite`. [ADR 0013](adr/0013-use-one-host-database-for-shared-data.md) records this decision.

## Storage ownership

| Store | Data |
|---|---|
| `database.sqlite` | Workspace registration, settings and lifecycle; task data; custom roles; prompt overrides; runtime policies; Git defaults; Autopilot policy; host identity; remote-access settings. |
| `config.json` | Theme, appearance, chat, Kanban, general UI, notifications, reusable prompts, model favorites, preferred Open In tool, active workspace, order, recent workspaces, and Agent Studio state. |
| Existing external files | Asset bytes and owner markers, worktrees, browser permissions and saved tabs, MCP discovery, logs, Electron profiles, and keychain secrets. |

The settings adapter composes reads from both stores. Saves contain edited fields. Shared edits commit first; preference edits follow. A preference failure after a shared commit reports the saved shared fields and retains the failed preference edits.

Runtime permission policies use `agent_runtime_settings.policy_json`. Known runtimes store their existing `defaults` and `roleOverrides` objects. Other runtimes keep this column NULL. Reads and writes validate the payload and preserve omitted fields, empty collections, false values, rule order, and duplicates.

Workspace removal deletes only the target registration and owned rows. It keeps the database file and other workspaces.

### GitLab accounts

- `gitlab_accounts` stores one row for each GitLab user on each instance. The OS secure store keeps the secret of each account under the service name `OpenDucktor GitLab`, keyed by the account ID.
- `workspace_gitlab_config` stores the instance URL, project path, linked account, project remote, and HTTP consent of a GitLab repository. Its account key uses `ON DELETE RESTRICT`, so an account cannot go while a workspace links it.
- The host deletes an account and its secret when no workspace links it: after a settings save that unlinks it, after workspace removal, and in the background at host start.

## Settings queries

Use the settings port's narrow global, Autopilot, workspace, repository-path, or catalog read for each caller. Reserve the full snapshot for callers that need all settings. Workspace projections use indexed child queries and preserve collection order without joining independent lists together.

Startup completes the import before the settings adapter exists, so settings reads do not check the import marker. A missing host settings row stops the read with one error that tells the user to restart the host.

| Read | SELECT statements |
|---|---:|
| Full settings | 3 |
| Global settings | 2 |
| Autopilot settings | 1 |
| One workspace, by ID or path | 1 |
| Workspace catalog, with its revision | 1 |

Settings writes compare each group with its current value and replace only changed groups. A runtime policy edit replaces one runtime row. Relational collection inserts use batches of 100 rows to stay within the supported SQLite bind limit. Query-budget tests cover these paths in the SQLite adapter.

## Upgrade and recovery

1. Stop all older hosts that use the config root. Every host that shares it must use a compatible upgraded version.
2. Start an upgraded host. It reads supported config versions 2 through 4 before it takes the database write lock. Tool discovery for a version 2 file runs at this step.
3. The import runs on a worker thread, so the host thread stays free. Electron shows an upgrade window until the import ends. The worker makes consistent snapshots of registered task stores in `<config-root>/.host-database-import`, normalizes the copies with the legacy migrations, and imports all sources and the completion marker in one transaction. It removes the snapshot folder when it ends, and again at the start of a later import.
4. After the database import commits, preserve the original settings file as `config.json.backup`. Atomically replace `config.json` with preferences-only version 5 before the host becomes ready. Preserve the first backup. A new config root writes default preferences without a backup.
5. If the database import fails, Electron shows the error, the named source, and the log location. Correct the named source or restore a compatible backup and restart. Original sources remain intact. If the file step fails after the database commit, startup stops with the file error. A restart finishes that step without importing data again.
6. Later starts use the root database and never import retained copies over current data. Original task-store databases remain in place. The JSON version and existing database completion marker control recovery; no second marker is stored.

A missing legacy workspace database represents an empty store. Unregistered directories remain untouched. An unreadable, corrupt, invalid, or unsupported existing source stops the import.

Migration preserves the data and migration history from `main`. Earlier schemas from this development branch are not supported upgrade sources.

Task-session start times retain their exact instant as integer milliseconds. Their public form becomes canonical UTC ISO 8601. A date that cannot convert without loss stops the import and identifies the record to correct.

Pull request and direct merge dates are also integer milliseconds. Their public form is canonical UTC ISO 8601. Providers can send precision below one millisecond, and the host drops it. A date that is not a zoned ISO 8601 date stops the import or the write and names the field.

## Backup and downgrade

For a compatible backup, stop all hosts and copy `database.sqlite` and `config.json`. Back up external asset files separately.

An older binary cannot use the host database and rejects preferences version 5. To run an older version, stop all hosts and restore `config.json.backup` as `config.json`. The original task-store databases are still in `task-stores`. Changes made after the upgrade are only in `database.sqlite`, so the older version does not show them.

When you upgrade again, the host database is already complete, so the host does not import changes that the older version made. If `config.json` is an older version again and differs from `config.json.backup`, startup stops and names both files. Keep the settings you need, move one file aside, then restart.

## Concurrent database access

Hosts acquire write ownership before reading values used by a mutation. Independent field edits merge against current rows. For valid edits to the same field, the last committed save wins. A stale save cannot recreate a removed target.

Processes use the same database without synchronization. Explicit reads return current committed rows. Another process's changes do not automatically refresh an open view. Use an explicit reload or later read to obtain them. Local commands keep the existing task and workspace-session events.

Autopilot starts only from qualifying local committed transitions. Startup, migration, and reads do not dispatch work. Queued work retains the existing host-local cancellation rules.

Runtime sessions and worktree activity are local to each host. When one host closes or removes a workspace, it checks only its own sessions. A session in another host can lose its worktree. Later database writes from that host fail with an actionable error. Close a workspace in every host before you remove it.

## Change the schema

1. Edit the typed schema modules, then run `bun run db:generate` in `packages/host`. It writes the next `drizzle-host` migration.
2. Never edit or regenerate a migration that a release contains. The host rejects a database whose applied migration history differs from its own files.
3. Write CHECK constraints with the `column` helper from `sqlite-schema-sql.ts`. A CHECK that names its table fails when SQLite rebuilds that table.
4. Use CHECK constraints for structural rules, such as Boolean values, ranges, and row variants. Validate open value lists, such as runtime kinds and icons, in `packages/contracts`. A new value then needs no table rebuild.
5. Review each `__new_` table rebuild in a generated migration. The host applies migrations with foreign keys off, as the SQLite schema change procedure requires, and then runs `PRAGMA foreign_key_check`. With foreign keys on, a rebuild deletes child rows through `ON DELETE CASCADE`.
6. Put large text and BLOB columns last in a table. SQLite reads a column after a large value through its overflow pages.

## Source owners

Typed schema modules are in `packages/host/src/adapters/sqlite`. Root migrations are in `drizzle-host`; `drizzle` remains only for legacy source normalization. `sqlite-host-database-import.ts` owns atomic import, and `host-database-import-worker.ts` runs it on a worker thread. `sqlite-task-repository-context.ts` owns the shared connection and applies the workspace access policy from `domain/workspace-access.ts`.
