---
status: accepted
date: 2026-06-10
---

# Use SQLite Task Store With Workspace-Scoped Database Path

OpenDucktor will replace the Beads/Dolt-backed Task Store with a SQLite-backed Task Store whose database lives at `<config-root>/task-stores/<workspaceId>/database.sqlite`. The path uses the technical `workspaceId` instead of a repo-derived id so task storage follows OpenDucktor's configured workspace identity, while invalid workspace ids fail fast rather than being silently normalized.

The Beads-to-SQLite migration will be a standalone one-time script that reads Beads through the `bd` CLI and writes SQLite directly. The script deliberately avoids importing Beads adapter internals so the Beads/Dolt production code can be removed cleanly after migration.

The migration script is read-only toward Beads/Dolt. It will not start, repair, initialize, or restore the legacy store; unreadable legacy storage is an explicit migration precondition failure.

The migration must be lossless for the Beads task data OpenDucktor owns and models. SQLite will preserve the current OpenDucktor-used Beads task schema, including historical document entries that the current OpenDucktor UI treats as latest-only.

SQLite is the clean OpenDucktor task-store model, not a raw Beads archive. We will keep the old Beads database outside the new runtime path for a while instead of polluting SQLite with catch-all legacy payload tables.

Migrated tasks keep their existing Beads ids exactly, and the native SQLite Task Store will continue generating new task ids in the same format. This preserves task references across MCP workflows, documents, transcripts, and existing user habits while allowing the storage engine to change.

The one-time migration parses the complete Beads snapshot before writing SQLite data and keeps validation to the minimum needed for a correct insert into the clean SQLite task-store schema. Unexpected or broken Beads data is a migration error, and persistence happens in one SQLite transaction so the new database is never partially migrated.

The migration script is insert-only. SQLite database creation and schema setup belong to the native SQLite Task Store, so the migration fails fast when the target `database.sqlite` does not already exist.

The first SQLite task-store schema stays intentionally small: task-scoped data remains inline on the task row, while Task Documents move to a dedicated table because they are larger and can have history. We are not introducing separate label, agent-session, Pull Request, or Direct Merge tables during the migration.

Task Documents are stored in SQLite as plain markdown text for now, with an explicit format field reserved for future encodings. The one-time migration decodes Beads' stored document encoding instead of carrying the legacy gzip/base64 representation forward.

Task and document timestamps preserve the same instant from Beads while using SQLite-friendly integer Unix epoch milliseconds instead of retaining source timestamp strings.

After the one-time migration, OpenDucktor runtime code becomes SQLite-only. Beads/Dolt production adapters, lifecycle code, diagnostics, tool discovery, and Electron sidecars are removed instead of kept as a fallback path.
