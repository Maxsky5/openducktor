# Task workflow status model

This document defines persisted task status, UI labels, issue type rules, and task document ownership.

## Source of truth

- The persisted `status` is the task lifecycle state.
- The backend validates each transition.
- The frontend renders the actions in `TaskCard.availableActions`. It does not infer actions from status.
- User fields and agent documents have separate owners.

## Statuses

| Stored status | UI label | Note |
|---|---|---|
| `open` | Backlog | Persisted backlog state. |
| `spec_ready` | Spec Ready | The task has a specification. |
| `ready_for_dev` | Ready for Dev | The task can start a build. |
| `in_progress` | In Progress | Build work is active or can resume. |
| `blocked` | Blocked needs input | Build work needs input. |
| `ai_review` | AI Review | QA can review the build. |
| `human_review` | Human Review | This still counts as work in progress for orchestration. |
| `closed` | Done | The task is closed. |

`close_task` is an administrative override. It does not prove that code was merged, QA passed, or all workflow steps finished.

## Issue types

The UI supports `epic`, `feature`, `task`, and `bug`. It does not support `chore` or `decision`.

`feature` and `epic` use this path:

```text
open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed
```

They cannot plan from `open`. A later spec or plan edit does not change a task that is already in `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, or `human_review`.

`task` and `bug` can skip the spec and plan:

```text
open -> in_progress
```

## QA defaults

`qaRequired` defaults to `true` for all four issue types.

When `qaRequired` is `true`, build completion moves to `ai_review` until the latest QA result is `approved`. When it is `false`, or the latest stored QA result is already `approved`, build completion moves to `human_review`.

## Epic rules

- Only an `epic` can have direct children.
- The hierarchy has one child level.
- A child cannot have children.
- An epic cannot close while a direct child is not `closed`.

## Task documents

Store agent-written output as task documents, not user task fields. SQLite stores plain Markdown and an explicit `format`.

### Role handoffs

| Role | Owns |
|---|---|
| Spec | Interview about product decisions, then user problem, scope, required behavior, constraints, and observable acceptance criteria. |
| Planner | Technical design, module responsibilities, architecture boundaries, interfaces, and data and state contracts. |
| Builder | Implementation details, work order, tests, and verification within the required outcomes and design contracts. |
| QA | Independent review of outcomes, contracts, correctness, and maintainability, with checks based on risk. |

Spec researches facts and uses the conversation to resolve product decisions. The user's answers settle those decisions. Spec records delegated assumptions and asks follow-up questions when an answer exposes a new choice that affects the result. A fully specified task can go straight to writing.

Spec and Planner own the work through saving the canonical document. A ready spec covers the agreed scope with requirements and acceptance criteria. A ready plan connects required outcomes to defined interfaces and integration points. Required decisions must be resolved before saving. Each role then saves in the same turn. Later revisions update the saved document. Completion depends on a successful tool call.

All roles follow the shared `Artifact format` rules in the built-in workflow prompt. These rules apply regardless of document type. Spec and Planner prompts define the content of each document section. The format follows the content: headings name topics, paragraphs explain reasoning, lists separate rules, and tables compare entries with common fields. There is no sentence or paragraph count limit.

System prompts own role responsibilities, decision policy, document structure, and completion. Kickoffs request the artifact for the current task. Keep general workflow instructions in the system prompt so kickoffs do not become a second policy source.

Spec and Planner describe what must hold. Keep test cases, test commands, evidence checklists, live verification, and smoke-test procedures out of these documents. Builder and QA choose verification methods and follow the repository's required checks. A required product behavior or quality limit remains part of the spec.

Plans distinguish required design decisions from suggestions. Builder can adapt suggested steps and implementation order while preserving the required outcomes and contracts. QA reviews the finished result against those requirements.

The built-in system and kickoff prompts live in `packages/core/src/services/agent-system-prompts.ts`. For each changed template, set `builtinVersion` to the target branch's version plus one. Increment it only once per PR, even when later commits revise the prompt. Existing custom overrides remain active. Users must review, update, or disable old overrides themselves. The app does not display a version-mismatch warning. A new built-in version does not replace custom text.

The prompt design uses the autonomy and testing guidance in the [OpenAI model guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra). The role contracts apply across supported models and runtimes.

The document contracts also draw on [Superpowers' plans for readers without conversation context](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-plans/SKILL.md), [GSD's distinction between settled decisions and agent discretion](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/get-shit-done/templates/context.md), and [OpenSpec's separation of behavior requirements from technical design](https://github.com/Fission-AI/OpenSpec/blob/9d4e5974e5c0d9a09b9c6c1e1eb0975e80ec4461/schemas/spec-driven/schema.yaml). OpenDucktor keeps its own role boundaries and lifecycle; these references do not add approval gates or prescribe Builder's execution method.

### Storage

| Kind | Current UI read |
|---|---|
| `spec` | Latest entry. |
| `implementationPlan` | Latest entry. |
| `qaReports` | Latest entry. |

The store can keep history. Each row has a task ID, kind, revision, Markdown body, format, optional QA result, source tool, updater, and update time. Frontend and MCP reads return plain Markdown.

```json
[
  { "kind": "spec", "sourceTool": "odt_set_spec" },
  { "kind": "implementationPlan", "sourceTool": "odt_set_plan" },
  { "kind": "qaReports", "sourceTool": "odt_qa_approved" }
]
```

Each write must keep unrelated durable task fields. Workflow rules use stored status, not UI labels.
