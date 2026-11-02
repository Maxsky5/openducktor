---
status: accepted
date: 2026-10-27
supersedes: 0006
---

# Use one host database for shared data

Store all workspace task data and shared host settings in `<config-root>/database.sqlite`. Keep presentation and navigation preferences in `config.json`. This supersedes the separate workspace database paths in [ADR 0006](0006-use-sqlite-task-store-with-workspace-scoped-database-path.md). One database permits atomic workspace and task changes and safe writes from hosts that share a config root.

Use full workspace keys in task, artifact, asset, and session relations. Preserve existing IDs. New task IDs are unique across all workspaces, so views across workspaces can name one task. Store timestamps as integer epoch milliseconds. Use typed columns and child tables. Store each runtime's default and role permission policies as one validated JSON object on its runtime settings row. Callers read complete policy objects; no SQL query uses their individual fields. Azure manual remote mappings retain one validated JSON array because their consumers replace that collection together.

Use rollback journaling, `synchronous=EXTRA`, and immediate write transactions. Wait for ordinary lock contention asynchronously. This avoids reliance on a SQLite upgrade for the [concurrent WAL-reset defect](https://www.sqlite.org/wal.html#the_wal_reset_bug), at the cost of less overlap between readers and writers.

Import legacy settings and consistent task-store snapshots in one transaction before host startup. Run the import on a worker thread, because the SQLite drivers block their thread. Commit one completion marker with all imported rows. Keep original databases and leave JSON unchanged until the database commit. Before readiness, preserve original JSON as `config.json.backup`, then atomically replace the active file with preferences-only version 5. Preserve the first backup. Use the existing database write lock, completion marker, and JSON version to finish an interrupted file step without importing data again. See [host database operations](../host-database.md).

Processes share the database without synchronization, change polling, or replay. Explicit reads return current committed data. Local commands retain the existing event paths and Autopilot behavior. Another process does not automatically refresh open views.
