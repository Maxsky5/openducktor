# Task Workflow Status Model

## Purpose
This document defines the canonical task workflow model for OpenDucktor.
It is the source of truth for:
- persisted Beads statuses,
- UI status labels,
- type-specific behavior,
- metadata ownership for agent-authored documents.

## Core Principles
- Beads `status` is the canonical lifecycle state.
- OpenDucktor does not use labels for lifecycle state.
- Transitions are backend-enforced and mostly tool-driven.
- User-authored fields and agent-authored documents are separated.

## Persisted Statuses (Beads)
OpenDucktor uses the following Beads statuses:
- Built-in: `open`, `in_progress`, `blocked`, `deferred`, `closed`
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
- `deferred` -> hidden from main Kanban (for now)

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
- `feature` and `epic` cannot start planning directly from `open`; `set_plan` is allowed from `spec_ready` and `ready_for_dev`.
- `task` and `bug` may skip spec/planning:
  `open -> in_progress`

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
- Subtasks cannot be deferred through OpenDucktor actions.
- Epic completion guard checks direct children only.
- For completion guard, deferred children are ignored.

## Deferred Rules
- Any non-closed parent issue can be deferred by user action.
- Deferred issues are excluded from Kanban for now.
- Resuming deferred issues returns them to `open`.
- Subtasks are not allowed to be deferred by OpenDucktor.

## Metadata Contract (Agent-Owned Documents)
Agent-authored documents are stored under issue `metadata` only, never in user-authored fields.

Root namespace key is fixed to `openducktor`.

### Namespace Key Requirement
- Value: `openducktor`
- All metadata reads/writes must use that key

### JSON Shape
```json
{
  "openducktor": {
    "qaRequired": true,
    "documents": {
      "spec": [
        {
          "markdown": "## Spec",
          "updatedAt": "2026-02-17T12:34:56Z",
          "updatedBy": "planner-agent",
          "sourceTool": "odt_set_spec",
          "revision": 1
        }
      ],
      "implementationPlan": [
        {
          "markdown": "## Plan",
          "updatedAt": "2026-02-17T12:40:10Z",
          "updatedBy": "planner-agent",
          "sourceTool": "odt_set_plan",
          "revision": 1
        }
      ],
      "qaReports": [
        {
          "markdown": "## QA",
          "verdict": "approved",
          "updatedAt": "2026-02-17T13:02:00Z",
          "updatedBy": "qa-agent",
          "sourceTool": "odt_qa_approved",
          "revision": 1
        }
      ]
    }
  }
}
```

## Document History Policy
- `qaReports`: list structure, but V1 retains only the latest entry in the list (list length = 1).
- `spec`: list structure, but V1 retains only the latest entry in the list (list length = 1).
- `implementationPlan`: list structure, but V1 retains only the latest entry in the list (list length = 1).

## Write Safety Rules
- Metadata updates must be read-merge-write.
- Unknown metadata keys must be preserved.
- Avoid reserved Beads metadata prefixes (`bd:`, `_`) for custom keys.
- No workflow-critical data should depend on UI-only labels.

## Compatibility Note
Beads `bd ready` is optimized for `status=open` semantics. OpenDucktor uses custom statuses for intermediate workflow states, so Kanban and orchestration logic must not rely on `bd ready` as the workflow source of truth.
