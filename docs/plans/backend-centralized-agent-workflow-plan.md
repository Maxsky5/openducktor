# Backend-Centralized Agent Workflow Plan

## Objective
Centralize all agent workflow business logic in backend and expose fully-derived role states on `TaskCard`.
Frontend must only render backend-provided workflow state.

## Contract Changes

### 1) Add `agentWorkflows` to `TaskCard`
Update `packages/contracts/src/index.ts`:

```ts
type AgentWorkflowState = {
  required: boolean;
  canSkip: boolean;
  available: boolean;
  completed: boolean;
};

type AgentWorkflows = {
  spec: AgentWorkflowState;
  planner: AgentWorkflowState;
  builder: AgentWorkflowState;
  qa: AgentWorkflowState;
};
```

Add:

```ts
taskCard.agentWorkflows: AgentWorkflows
```

Also extend task payload to carry latest QA verdict directly on task data (not as a separate query parameter), for example:

```ts
type QaWorkflowVerdict = "approved" | "rejected" | "not_reviewed";
taskCard.documentSummary.qaReport.verdict: QaWorkflowVerdict;
```

## Backend Derivation

### 2) Implement one derivation function in backend
Create one function used by all task-read/list endpoints:

```ts
deriveAgentWorkflows(task): AgentWorkflows
```

Inputs:
- `task.issueType`
- `task.status`
- `task.aiReviewEnabled` (or canonical backend QA-required source)
- `task.documentSummary`

Do not use:
- session history
- chat messages
- tool-call history

## Availability Rule Model

### 3) Availability is monotonic
Once a role becomes available for a task, it must stay available for that task.
Availability is computed directly in each role rule below.
Precedence rule: if `status === "closed"`, `available` is always `false`.
If a task is reopened from `closed`, availability is recomputed from current status rules.

## Canonical Per-Role Rules

Assume:
- `isFeatureEpic = issueType === "feature" || issueType === "epic"`
- `isTaskBug = issueType === "task" || issueType === "bug"`
- `qaRequired = task.aiReviewEnabled === true` (or canonical backend equivalent)

### 4) `spec`
- `required`:
  - `true` for `feature|epic`
  - `false` for `task|bug`
- `canSkip`:
  - `false` for `feature|epic`
  - `true` for `task|bug`
- `available`:
  - `false` when `status === "closed"`
  - otherwise `true`
- `completed`:
  - `true` when `task.documentSummary.spec.has === true`
  - otherwise `false`

### 5) `planner`
- `required`:
  - `true` for `feature|epic`
  - `false` for `task|bug`
- `canSkip`:
  - `false` for `feature|epic`
  - `true` for `task|bug`
- `available`:
  - `false` when `status === "closed"`
  - always `true` for `task|bug`
  - for `feature|epic`: `true` when `status` is one of:
    - `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review`
  - otherwise `false`
- `completed`:
  - `true` when `task.documentSummary.plan.has === true`
  - otherwise `false`

### 6) `builder`
- `required`: `true`
- `canSkip`: `false`
- `available`:
  - `false` when `status === "closed"`
  - always `true` for `task|bug`
  - for `feature|epic`: `true` when `status` is one of:
    - `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review`
  - otherwise `false`
- `completed`:
  - `true` when `status` is one of:
    - `ai_review`, `human_review`, `closed`
  - otherwise `false`

### 7) `qa`
- `required`:
  - `true` when `qaRequired === true`
  - `false` when `qaRequired === false`
- `canSkip`:
  - `false` when `qaRequired === true`
  - `true` when `qaRequired === false`
- `available`:
  - `true` when `status === "ai_review"` (independent of `qaRequired`)
  - otherwise `false`
- `completed`:
  - `true` when `task.documentSummary.qaReport.verdict === "approved"`
  - `false` when verdict is `rejected` or `not_reviewed`

## Frontend Integration

### 8) Frontend renders backend truth
Remove workflow business logic from:
- `apps/desktop/src/pages/agents-page-session-tabs.ts`

Use `task.agentWorkflows` for all non-runtime workflow state.

UI state mapping:
- `in_progress`: active role session status is `starting|running`
- else `done`: `agentWorkflows[role].completed`
- else `available`: `agentWorkflows[role].available`
- else `optional`: `agentWorkflows[role].canSkip`
- else `blocked`

### 9) Agent selection and interaction behavior
- User can select any agent role in the UI, even when `agentWorkflows[role].available === false`.
- When selected role is not available:
  - workflow role button remains selectable but uses disabled visual style,
  - action buttons are hidden (for example start spec/start implementation actions),
  - message input is disabled (read-only/view mode for that role),
  - `Stop` remains visible/enabled if there is a running/starting session for that role.
- When selected role is available:
  - action buttons are shown according to existing session/workflow state,
  - message input is enabled according to existing runtime/session constraints.
- If frontend attempts to start/send for an unavailable role (race/stale state), backend rejects the request and frontend displays an error toast.
- Stop/cancel must remain allowed even when selected role is unavailable.

## Rollout Steps
1. Add `agentWorkflows` schema/types in `packages/contracts`.
2. Implement `deriveAgentWorkflows(task)` in backend domain/app layer.
3. Ensure task list/get APIs populate `TaskCard.agentWorkflows`.
4. Update desktop frontend to consume `task.agentWorkflows` only.
5. Add backend guardrails to reject start/send actions when selected role is unavailable.
6. Handle unavailable-action rejection in frontend and display an error toast.
7. Remove obsolete frontend inference code and tests.
8. Add backend tests for status/type/qa/document matrix.
9. Add frontend tests proving it only maps provided contract values.

## Required Tests

### Backend tests
- Spec availability always true.
- Planner availability:
  - always true for `task|bug`
  - for `feature|epic`, false in `open`, true from `spec_ready` to `human_review`
  - false in `closed`
- Builder availability:
  - always true for `task|bug`
  - for `feature|epic`, true from `ready_for_dev` to `human_review`
  - false in `closed`
- QA availability:
  - true in `ai_review` regardless of `qaRequired`
  - false in `closed`
- QA required/canSkip:
  - determined only by `qaRequired`.
- QA completed:
  - true only when task payload QA verdict is `approved`
  - false for `rejected` or `not_reviewed`.
- Closed precedence and reopen recompute:
  - `closed` always forces `available = false` for all roles
  - after reopen, availability recomputes from status rules.
- Unavailable action guard:
  - backend rejects unavailable role start/send requests.
  - backend still allows stop/cancel for running sessions.

### Frontend tests
- Workflow rail derives from `task.agentWorkflows`, not session/tool history.
- Runtime session only overlays `in_progress`.
- Optional roles render optional state (`canSkip`), not done.
- User can select unavailable roles.
- Selecting unavailable role hides action buttons and disables message input.
- Selecting available role restores actions/input behavior.
- Rejected unavailable actions surface an error toast.
- Running session can always be canceled, even if selected role is currently unavailable.
