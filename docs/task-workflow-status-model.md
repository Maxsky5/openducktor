# Task Workflow Status Model

## Purpose
This document defines the canonical task workflow model for OpenDucktor.
It is the source of truth for:
- persisted task statuses,
- UI status labels,
- type-specific behavior,
- metadata ownership for agent-authored documents.

## Core Principles
- The persisted task `status` is the canonical lifecycle state.
- OpenDucktor does not use labels for lifecycle state.
- Transitions are backend-enforced and mostly tool-driven.
- User-authored fields and agent-authored documents are separated.

## Persisted Statuses
OpenDucktor uses the following task statuses:
- Built-in: `open`, `in_progress`, `blocked`, `closed`
- Custom: `spec_ready`, `ready_for_dev`, `ai_review`, `human_review`

Notes:
- `open` is used as the persisted backlog state.
- UI displays `open` as `Backlog`.
- `human_review` is considered in-progress work from an orchestration perspective.

## UI Mapping
- `open` -> `Backlog`
- `spec_ready` -> `Spec Ready`
- `ready_for_dev` -> `Ready for Dev`
- `in_progress` -> `In Progress`
- `blocked` -> `Blocked needs input`
- `ai_review` -> `AI Review`
- `human_review` -> `Human Review`
- `closed` -> `Done`

## Task Capability Contract (Backend-Driven)
- Backend computes allowed task actions and returns them on each `TaskCard` as `availableActions`.
- Frontend must render action buttons from `availableActions` and must not infer workflow actions from local status heuristics.
- This keeps workflow authority in the backend transition matrix while allowing UI-specific presentation (button order, emphasis, labels).

## Issue Types in Scope
Allowed issue types in OpenDucktor UI:
- `epic`
- `feature`
- `task`
- `bug`

Removed from OpenDucktor UI scope:
- `chore`
- `decision`

## Type-Specific Flow Rules
- `feature` and `epic` follow the standard path:
  `open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed`
- `feature` and `epic` cannot start planning directly from `open`; `set_plan` is allowed from `spec_ready`, `ready_for_dev`, and later active/review states as document revisions.
- `task` and `bug` may skip spec/planning:
  `open -> in_progress`
- Spec and plan documents can be revised during `in_progress`, `blocked`, `ai_review`, and `human_review` without changing task status.

## QA Requirement Defaults
`qaRequired` defaults by issue type:
- `epic`: `true`
- `feature`: `true`
- `task`: `true` (for now)
- `bug`: `true` (for now)

When `qaRequired=true`, build completion returns to `ai_review` until the latest QA verdict is `approved`.
When `qaRequired=false`, or when the latest QA verdict is already `approved`, build completion goes directly to `human_review`.

## Epic/Subtask Rules
- Only `epic` can have subtasks.
- Max hierarchy depth is 1 level.
- Subtasks cannot have subtasks.
- Epic completion guard checks direct children only.
- Epic completion guard blocks while any direct child is not `closed`.

## Document Contract (Agent-Owned Documents)
Agent-authored documents are stored as task documents only, never in user-authored task fields.

SQLite stores document bodies as plain markdown with an explicit `format` value. The current document kinds are:

- `spec`
- `implementationPlan`
- `qaReports`

Document rows include task id, kind, revision, markdown, format, optional QA verdict, source tool, updater, and update timestamp.
Frontend and MCP callers receive plain markdown on successful reads.

Example document rows keep canonical workflow source tools explicit:

```json
[
  { "kind": "spec", "sourceTool": "odt_set_spec" },
  { "kind": "implementationPlan", "sourceTool": "odt_set_plan" },
  { "kind": "qaReports", "sourceTool": "odt_qa_approved" }
]
```

## Document History Policy
- `qaReports`: history may be retained, but V1 UI surfaces the latest entry.
- `spec`: history may be retained, but V1 UI surfaces the latest entry.
- `implementationPlan`: history may be retained, but V1 UI surfaces the latest entry.

## Write Safety Rules
- Task-store updates must preserve unrelated durable task fields.
- No workflow-critical data should depend on UI-only labels.
