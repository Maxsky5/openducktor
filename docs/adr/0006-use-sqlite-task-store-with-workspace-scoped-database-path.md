---
status: accepted
date: 2026-06-10
---

# Use a SQLite task store with a workspace-scoped database path

## Decision

Replace the Beads and Dolt task store with SQLite at `<config-root>/task-stores/<workspaceId>/database.sqlite`. Use the configured `workspaceId`. Reject an invalid ID. Do not derive or normalize it from the repository.

Use a one-time migration script. It reads Beads through the `bd` CLI and writes SQLite. It does not import the old adapter code.

## Migration rules

- Treat Beads and Dolt as read-only. If the old store cannot be read, stop with a migration error. Do not start, repair, initialize, or restore it.
- Parse and validate the full Beads snapshot before the SQLite write.
- Preserve all Beads task data that OpenDucktor owns, including document history.
- Keep each Beads task ID as the SQLite task ID.
- Generate IDs in the same format only for tasks created after the migration.
- Write all rows in one SQLite transaction.
- Insert into an existing `database.sqlite`. The native task store owns database creation and schema setup.
- Store clean OpenDucktor data. Do not add a catch-all legacy payload table.
- Decode old document data and store plain Markdown with an explicit format field.
- Preserve timestamp instants as Unix epoch milliseconds.

## Data model

Keep task-scoped data on the task row. Store task documents in a separate table because they can be large and can have history. Do not add separate label, agent-session, pull request, or direct merge tables as part of this migration.

Keep the old Beads database outside the new runtime path for a limited time. After migration, remove Beads and Dolt adapters, lifecycle code, checks, tool discovery, and Electron sidecars. Runtime code uses SQLite only.
