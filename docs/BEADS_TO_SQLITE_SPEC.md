# Beads To SQLite Migration Spec

## Goal

Migrate OpenDucktor's Task Store from the current Beads/Dolt-backed storage to a SQLite-backed storage while preserving existing task workflow data for the current configured workspace.

## Storage Location

The SQLite database is stored under the OpenDucktor config root and keyed by the technical `workspaceId`, not by a repo-derived id:

```text
<config-root>/task-stores/<workspaceId>/database.sqlite
```

The path resolver must use the `workspaceId` literally. Workspace ids are already validated when a repository is opened; the SQLite path resolver should reject invalid workspace ids as an invariant violation rather than normalizing or sanitizing them.

The migration script derives both the legacy Beads attachment path and the target SQLite path from the same `configDir` and `workspaceId` inputs:

```text
<config-root>/beads/<workspaceId>/.beads
<config-root>/task-stores/<workspaceId>/database.sqlite
```

It should not require a separate `--beads-dir` input for the normal migration path.

## Script Interface

The migration script requires only:

```sh
bun run scripts/migrate-beads-to-sqlite.ts --config-dir <config-root> --workspace-id <workspaceId>
```

It must not require `--repo-path`; the migration is based on the managed OpenDucktor storage paths derived from `configDir` and `workspaceId`.

The script runs `bd` from `PATH`. It must not implement OpenDucktor tool discovery, bundled sidecar lookup, or an alternate `--bd-path` option.

The script reads the legacy shared Dolt server route from:

```text
<config-root>/beads/shared-server/server.json
```

It uses that route to set `BEADS_DOLT_SERVER_MODE`, `BEADS_DOLT_SERVER_HOST`, `BEADS_DOLT_SERVER_PORT`, and `BEADS_DOLT_SERVER_USER` before invoking `bd`. If the server state file is missing or `bd where --json` cannot confirm the expected attachment, the script fails.

## Migration Shape

The migration is a one-time local script, not a long-lived application compatibility layer. It reads the existing Beads store through the `bd` CLI and writes directly into the SQLite database.

The migration script must be standalone with respect to Beads. It may shell out to `bd` and contain its own small migration-only parser for Beads JSON and OpenDucktor document metadata, but it must not import `packages/host/src/adapters/beads/*` or `packages/host/src/infrastructure/beads/*`. This keeps the production Beads/Dolt adapter tree removable after the migration is complete.

The migration script is read-only with respect to Beads and Dolt. It must not initialize, repair, restore, start, or stop Beads/Dolt infrastructure. If the existing Beads store is not readable through `bd`, the script must fail with an actionable error instead of attempting recovery.

## SQLite Schema Shape

The SQLite Task Store schema is intentionally small. It stores task-scoped data inline and splits only Task Documents into their own table.

Suggested task columns:

```text
tasks(
  id text primary key,
  title text not null,
  description text not null,
  status text not null,
  issue_type text not null,
  priority integer not null,
  parent_id text null,
  qa_required integer not null,
  labels_json text not null,
  agent_sessions_json text not null,
  target_branch_json text null,
  pull_request_json text null,
  direct_merge_json text null,
  created_at_ms integer not null,
  updated_at_ms integer not null
)
```

Suggested document columns:

```text
task_documents(
  task_id text not null,
  kind text not null,
  revision integer not null,
  markdown text not null,
  format text not null,
  verdict text null,
  source_tool text null,
  updated_by text null,
  updated_at_ms integer null,
  primary key(task_id, kind, revision),
  foreign key(task_id) references tasks(id)
)
```

The exact schema can evolve during implementation, but it should preserve this shape: scalar task columns, inline JSON text for task-scoped nested data, and a dedicated document history table.

## Migration Fidelity

The migration must be lossless for the Beads task data OpenDucktor owns and models. Everything in the current OpenDucktor-used Beads task schema must be represented in SQLite, not only the subset currently displayed by OpenDucktor.

Task Documents must preserve every document entry present in Beads metadata arrays, including historical `spec`, `implementationPlan`, and `qaReports` entries. The application may continue to read the latest entry for current workflow behavior, but the migration must not discard older entries.

The SQLite database must remain a clean OpenDucktor task-store model, not a raw Beads archive. The migration must not add catch-all raw Beads JSON tables solely as a safety net. The existing Beads database may be retained outside the new runtime path for temporary rollback or forensic inspection.

The script migrates OpenDucktor task records only: `epic`, `feature`, `task`, and `bug`. Beads-internal records such as `event` or `gate` are not imported as Tasks.

The migration is schema-to-schema. OpenDucktor knows the current Beads task schema it uses, and SQLite should model the same task-store data directly. Data outside that known schema is ignored by default and is not a migration concern.

Labels remain task-scoped for this migration. SQLite should store the labels attached to each task inline with the task data, not introduce a label table or a task-label association table.

Task-scoped data should stay inline on the task row unless there is a concrete reason to split it out. For this migration, documents are the only dedicated child table because they can be large and can have history. Labels, agent sessions, Pull Request data, Direct Merge data, target branch data, and similar task-scoped metadata should be stored inline.

Inline task-scoped structured data should use SQLite JSON text columns. Core task fields such as id, title, status, issue type, priority, description, parent id, QA-required flag, created timestamp, and updated timestamp remain scalar columns; repeated or nested task-scoped values such as labels, agent sessions, target branch, Pull Request, and Direct Merge are stored as JSON text columns on `tasks`.

Beads `notes` is not migrated because OpenDucktor does not currently use it and the existing Beads data is empty. If notes become product-relevant later, they should be introduced deliberately in the SQLite Task Store rather than carried over by this migration.

Beads owner/assignee data is not migrated. OpenDucktor does not yet have a real user model, and carrying firstname/lastname text into SQLite would preserve a weak representation that the product does not use.

Subtask lists are derived from task parent references and are not stored as separate task data. SQLite stores each task's parent id; read models can derive child task ids from that relationship.

The intended schema shape is therefore:

```text
tasks
task_documents
```

Additional tables should not be introduced during the migration unless the SQLite Task Store needs them for schema bookkeeping.

Task Documents must be stored as plain markdown text in SQLite for now. The migration script decodes Beads document entries that use `gzip-base64-v1` and also supports legacy literal markdown entries, then writes the decoded markdown to `task_documents`.

The document table must still include a format field so future document encodings do not require a schema change. Migrated documents use `plain_text`.

Document revisions from Beads must be preserved exactly when present. If a legacy document entry has no revision, the migration may infer a revision from the entry order for that document kind.

Document kinds in SQLite use native OpenDucktor names:

| Beads metadata key | SQLite document kind |
|---|---|
| `spec` | `spec` |
| `implementationPlan` | `implementation_plan` |
| `qaReports` | `qa_report` |

`task_documents` has a nullable `verdict` field. Only `qa_report` rows should carry a QA verdict; `spec` and `implementation_plan` rows should leave it null.

Timestamps must preserve the same instant from Beads, but SQLite does not need to store the original timestamp string. SQLite timestamp columns should use integer Unix epoch milliseconds. The migration script must parse Beads timestamp strings and fail if a required timestamp cannot be parsed.

## Task Identity

Migrated tasks must preserve their Beads task ids exactly, including prefixes and parent/dependency references. The SQLite migration must not generate replacement ids for existing tasks.

New tasks created after migration should keep the same task id format as the current Beads-backed store so existing task references, MCP workflows, transcripts, and user muscle memory remain stable.

## Validation And Write Semantics

The migration script must parse the full Beads snapshot before writing SQLite data. It should reject broken or unexpected data instead of coercing it, but it must keep validation to the minimum required for a correct one-time migration.

Minimum validation means checking the fields needed to insert into the clean SQLite task-store schema and preserve existing OpenDucktor contracts, such as required task fields, supported issue types and task statuses, decodable document payloads, and valid JSON metadata shapes that the migration reads.

SQLite writes must be all-or-nothing. The script must persist the validated snapshot in a single transaction and must not leave a partially migrated database behind when validation or persistence fails.

The migration script is insert-only for SQLite. It must not create the SQLite database, create tables, run schema migrations, or repair schema drift. The SQLite Task Store implementation owns database initialization and schema management. If `<config-root>/task-stores/<workspaceId>/database.sqlite` does not already exist, the migration script must fail fast.

The script does not need a destination-empty preflight. It can rely on normal SQLite constraints inside the transaction to reject duplicate or conflicting inserts.

## Migration Report

After a successful migration, the script must print a concise report:

- target database path
- number of tasks inserted
- number of task documents inserted
- number of skipped Beads-internal records

The script should avoid verbose per-task output unless it fails.

## Post-Migration Runtime

After the migration succeeds, OpenDucktor runtime code should be SQLite-only. The Beads/Dolt production adapter, lifecycle code, diagnostics, tool-discovery entries, packaged sidecars, and related tests/docs should be removed as part of the refactor. There must be no runtime fallback from SQLite to Beads/Dolt.

The old Beads database may be kept outside the runtime path for a while as a manual archive, but OpenDucktor should no longer read from it.

The migration script remains in `scripts/` after the refactor. Removing the script is a separate future decision.
