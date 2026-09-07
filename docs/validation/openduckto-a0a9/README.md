# Session kickoff acceptance record

Task `openduckto-a0a9`. Live validation passed on application commit `800022b1ac33303ea33014d6e1873983fd5f9649` on 2026-09-08, Europe/Paris. The user started `http://localhost:58587/` from this task worktree. All launches used the real OpenDucktor backend and OpenCode runtime. This record supplies the live and build evidence requested by the latest QA report; it adds no application changes.

## Environment and method

The existing local4 `openducktor` workspace required an absent `.env` copy source. Two initial attempts stopped before session creation and sent no prompts. Its settings remained unchanged. The successful checks used an isolated Git repository at `/private/tmp/a0a9-live/repo`, a local remote at `/tmp/a0a9-live/origin.git`, workspace `a0a9-live`, and test task `a0a9-live-jwuv`. The fixture contains one README. It uses no setup script and has no uncommitted changes from the test sessions.

The browser session was `a0a9-live-0dd0e00d04c9`. It is now closed. The fixture and test tasks remain available for review. The original captures are in `/Users/maxsky5/.codex/artifacts/openduckto-a0a9-live-20260908/`; original HAR files are in `/tmp/a0a9-live/`. The evidence needed to check the outcomes below is also included in this directory.

Every start and send used this exact selection:

```json
{
  "runtimeKind": "opencode",
  "providerId": "opencode-go",
  "modelId": "gpt-5.6-luna",
  "profileId": "build",
  "variant": "none"
}
```

The target branch was `origin/main`. The host prepared `/Users/maxsky5/.openducktor-local4/worktrees/a0a9-live/a0a9-live-jwuv` through `agent_session_workflow_start`.

## Observed outcomes

| Scenario | Fresh starts | Send attempts | Successful sends | Observed result |
|---|---:|---:|---:|---|
| Prepare Builder | 0 | 0 | 0 | The composer remains editable. |
| Custom Kanban background launch | 1 | 1 | 1 | The page stays on Kanban. The runtime stores the exact long prompt and replies `A0A9-KANBAN-OK`. |
| Custom explicit Agent Studio launch | 1 | 1 | 1 | The explicit action opens the modal. The keyboard-edited prompt reaches the runtime, which replies `A0A9-STUDIO-OK`. |
| Prepared Builder Enter submission | 1 | 1 | 1 | No start modal opens. The runtime receives only the draft and replies `A0A9-DIRECT-OK`. |
| First-send failure and manual retry | 1 | 2 | 1 | The draft and new session survive the failure. Send retries in that session and receives `A0A9-RETRY-OK`. |

[evidence.json](evidence.json) contains selected fields from the captured start/send requests, responses, and native OpenCode history. It omits system prompts, unrelated traffic, and non-text native parts. It also records SHA-256 hashes of the original JSON captures. Each successful native session has exactly one user message. Its text matches the submitted parts exactly. Each native assistant message contains the expected reply marker.

Native history came from the runtime's documented `GET /session/:id/message` endpoint, using the observed runtime route and the session worktree directory. See the [OpenCode message API](https://opencode.ai/docs/server/#messages). This read verified stored runtime messages separately from the frontend and host response.

| Scenario | Native session ID | User text length |
|---|---|---:|
| Kanban | `ses_f81d7045fffelm6Xy5F4R5h5or` | 3,345 |
| Explicit Agent Studio | `ses_f81d5a350ffea92NJOi0Ineu4S` | 119 |
| Direct prepared submit | `ses_f81d4bf78ffeOL3vXITe1lD6cY` | 97 |
| Failed send and retry | `ses_f81d24215ffe4FSMjf2YdvTxY2` | 95 |

The Kanban text includes an initial newline and two spaces, 40 literal `{task.title}` lines, and final spaces and a newline. Its SHA-256 is `694d9fddbe8bacce5fa61676bdf8d5810c49f476c647d23fa69828c7335eaf95`. The exact text is stored as JSON strings in the request and native-history fields. The accepted host `parts` also preserves it. The host's separate display `message` string omits the leading whitespace; this record uses native history for the delivery assertion.

## Keyboard, layout, and recovery

Space enabled the customization toggle. Enter inserted a newline in the prompt editor, and keyboard typing added `Keyboard-edited line.` to the explicit Studio prompt. Enter in the prepared Builder composer submitted directly. A DOM MutationObserver watched added dialogs during that submission and recorded zero `Start Builder Session` appearances.

The 40-line prompt stays inside a scrolling editor with a visible footer in [light mode](kanban-long-light.png) and [dark mode](kanban-long-dark.png), at a viewport of 1280 by 577. Whitespace-only custom text disabled both launch buttons. Cancel and reopen restored the configured prompt with customization off. The [direct submission screenshot](direct-delivered.png) shows the draft and reply without a launch dialog.

For recovery, the browser deliberately aborted `**/invoke/agent_session_control_send` after a real session start. The UI displayed `Failed to send message: Failed to fetch` and retained the draft. After the route was removed, clicking Send used the same session ID and exact text. The trace contains one start, one aborted send with status `0`, and one successful send with status `200`. Native history contains one user message, with no generated kickoff or automatic resend. The [retry screenshot](retry-delivered.png) shows the failure and successful reply in the same conversation.

This recovery check covers a browser-to-backend transport failure. It does not claim a runtime-native failure. The original directory also contains `first-send-failed.png` under `screenshots/` and `retry.webm`. The video recorder opens a fresh browser context; the task was reopened and prepared again before the counted failure attempt.

## Build and repository checks

The full commands ran from the implementation worktree on `800022b1a` and each exited with status `0`:

| Command | Result |
|---|---|
| `bun run format:check` | Passed. |
| `bun run lint` | Passed, including frontend and host boundary guards. |
| `bun run typecheck` | Passed across workspaces. |
| `bun run test` | Passed. Frontend: 5,382 passed, 0 failed across 568 files. Scripts: 17 passed, 0 failed. |
| `bun run build` | Passed. Captured command, exit status, and output excerpt: [build-output.txt](build-output.txt). |

The build output includes `@openducktor/electron build: Exited with code 0`, `@openducktor/web build: Exited with code 0`, and `@openducktor/frontend build: Exited with code 0`. It also includes the existing bundle-size warning. The warning did not fail the build. Checks used installed Bun 1.3.10; the repository specifies Bun 1.3.14. No dependency changes were made.

React Doctor scored 83 with zero errors and the same three existing complexity warnings. The current suite includes the task/workspace/role confirmation tests that keep B busy after A completes. The latest QA report confirmed those fixes and reported no new material code defect. This evidence completes the requested live matrix; automated coverage remains responsible for the other roles, reuse/fork modes, and controlled async interleavings.
