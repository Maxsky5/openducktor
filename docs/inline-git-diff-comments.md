# Inline Git diff comments

## Ownership and Send

Task comments belong to the workspace and task, across roles and runtime sessions. Workspace comments belong to the workspace and saved workspace session record, including before runtime startup. Sessions that use the same directory have separate comments.

The Git panel shares annotation actions and restored-file validation for both owner kinds. The composer uses `useReviewCommentComposer` to capture pending comment revisions and the Send callback before asynchronous preparation. New comments stay pending for the next Send. Submitted comments cannot be edited or removed until the send settles.

Known message acceptance clears the captured batch once. A rejected send restores that batch. The normal composer draft store recovers the original text and attachments without the comment appendix, and keeps newer edits. A session that disappears during preparation rejects the send with an error. A later update or save failure cannot change known acceptance.

## Local storage compatibility

The approved plan for `openduckto-c046l` permits the workspace-session namespace and record below. This change does not migrate task records or change SQLite or saved session fields.

| Owner | Storage key |
|---|---|
| Task, unchanged | `openducktor:git-diff-comments:v1:<encoded workspaceId>:<encoded taskId>` |
| Workspace session | `openducktor:git-diff-comments:workspace-session:v1:<encoded workspaceId>:<encoded sessionId>` |

Task v1 records keep `version`, `workspaceId`, `taskId`, `updatedAt`, and `comments`. Workspace-session v1 records use `workspaceSessionId` in place of `taskId`. The shared codec selects the record schema from its key namespace and checks its identity. Matching task and session IDs cannot share a record. Older readers can still read task v1 records and ignore workspace-session records.

Each owner hydrates its exact key. Hydration keeps newer in-memory drafts. Both formats expire seven days after `updatedAt` and have a 131,072-byte payload limit. Invalid, future-dated, expired, mismatched, and oversized records cannot become sendable comments. Storage failures and size warnings belong to the affected owner.

The first successful available diff validates each restored scope against its full file list. Loading, failed reads, and unavailable comparisons do not remove comments. Neutral `HEAD` reads do not validate an unavailable target comparison.

Each scope keeps its read error until its own full diff read succeeds. A successful read of the other scope or a summary-only read cannot clear that error or remove restored comments.

## Related work

This feature uses the existing composer model and Send result contract. `openduckto-ln9zq` owns composer presentation, `openduckto-2lhhf` owns queued-send policy, and `openduckto-snssd` owns model preparation. This change also repairs the shared missing-session send branch described in `openduckto-9wt20`. It adds no queue, automatic retry, model policy, or dev-server behavior.
