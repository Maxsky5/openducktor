# Task artifacts

Open the Artifacts tab in Agent Studio or the Artifacts section in task details to see a task's saved outputs. Task details does not need an agent session. The collection contains each current workflow artifact and each free artifact. It does not contain old workflow revisions or description images.

## Open an artifact

Spec sessions open the Specification. Planner and Builder sessions open the Implementation Plan. QA sessions open the QA Report. If the workflow artifact does not exist yet, the panel names the missing output.

Use All artifacts to open the collection and choose another item. The panel keeps this choice when you switch tabs or hide the panel. A different workspace, repository, task, role, or selected session resets the choice. Task details starts at the collection.

A mounted task view loads its existing Specification, Implementation Plan, and QA Report together. These reads do not wait for session history or live context. They stay active while the task view remains mounted, including when it is hidden. A role change uses the content already loaded for that task. The client does not load artifact bodies for every task on the board.

A return to a previously opened artifact shows its cached content at once. After the task view closes, completed reads keep the connection's normal 10-minute inactive cache lifetime. Live changes refresh affected reads. Closing the view releases its preview frames, ports, and image URLs; closing the workspace removes its cached artifact reads.

Workflow previews and editors share one Markdown query per task and workflow kind. Each query uses its direct host read without waiting for the artifact collection. The task summary identifies outputs that do not exist yet. After a session change passes the navigation guard, the client also starts its selected read before changing the route. Readers share pending work; deletion and workspace release still cancel it. Markdown text appears while code, math, and diagram renderers load.

Background workspace session refreshes wait in a client queue that matches the host's single refresh lane. Queued refreshes do not hold browser connections needed by artifact reads. Each failure reaches its caller, and later refreshes can proceed. Closing a workspace skips its queued refreshes.

## Workflow and free artifacts

| Class | Content | Effect on workflow |
|---|---|---|
| Workflow | Specification, Implementation Plan, and QA Report in Markdown. | The existing submission actions control status and QA verdicts. |
| Free | Files saved by a user or agent. | Creating, renaming, replacing, or deleting a file does not change status or QA verdicts. |

An artifact belongs to one task in one workspace. Its stable code and classification do not depend on its display name. The workflow codes `spec`, `plan`, and `qaReport` are reserved. Each free-artifact code is unique within its task and never changes. A free artifact named "Specification" remains free and cannot satisfy a workflow prerequisite. The artifact setter routes each workflow code to its existing domain operation.

Manual Specification and Implementation Plan edits save content without changing task status, including on closed tasks. Workflow submissions keep their existing role, status, and validation rules. See [task actions](task-workflow-actions.md) and the [transition matrix](task-workflow-transition-matrix.md).

## Add and manage files

Select Add artifact, choose a file, check its display name, and save it. Each free artifact can contain at most 10 MiB of decoded bytes. The host also checks this limit for agent requests. A rejected replacement keeps the last saved content.

Creating a file with an existing name creates another artifact. UI uploads get a unique code based on the name. Rename and Replace content keep the selected artifact's code and identity. Delete names the selected artifact and requires confirmation. These controls are unavailable while the task is closed.

The workspace SQLite task store saves free-artifact bytes as BLOB data. It does not keep a path to the source file. Artifacts survive session completion, app restart, and task worktree removal. List reads return metadata without file bodies. A content read captures one artifact version; a continued read fails if that version changes.

Download returns the original saved bytes with the stored filename after an explicit user action. Preview conversion does not change the original content. Invalid UTF-8 text produces a preview error instead of replacement characters. Download remains available when the original content is readable. Workflow artifacts retain Copy and Expand; free artifacts have Download and Expand. Expand shows the loaded content in a larger dialog, keeps that content stable while open, and returns focus to its button when closed. The inline preview stays mounted.

## Preview formats and isolation

Rename and reads with identical bytes keep the preview's scroll position and local interaction state. A metadata change that needs a new content read keeps the last completed preview visible with an Updating preview notice. Download waits for the current bytes and metadata. A failed read removes the previous preview and shows an error.

HTML fills the available width and height in the panel and expanded dialog. The artifact document owns its scrolling. Task details gives embedded previews a bounded height within the sheet.

Fragment links stay within the current HTML preview. The trusted bootstrap sets `about:srcdoc` as the local base URL, so the browser handles scrolling, repeated links, and keyboard activation. The preview keeps the stored HTML unchanged. The base policy permits only `about:` URLs; network access and frame permissions remain blocked.

| Format | Presentation |
|---|---|
| Markdown | The existing Markdown renderer. |
| Plain text | Literal text with its line breaks. |
| HTML | Local scripts and embedded content in an isolated preview. |
| PNG, JPEG, WebP, GIF, SVG | Image display with the original proportions and animation. |
| Other formats | File details, an unsupported-preview message, and Download. |

Uncached Mermaid diagrams start drawing when they come within 200 pixels of the visible area. The document can paint before the drawing starts. Cached diagrams appear at once, including after a return to the artifact.

Scripted HTML previews require a recognized Chromium engine at version 152 or later. The browser client checks its own engine, even when it connects to an Electron host. Electron checks its bundled Chromium version. An older or unknown engine shows an isolation-unavailable message and keeps Download available. Chrome introduced the required network policy in version 152. See [Chrome's Connection Allowlist documentation](https://developer.chrome.com/blog/connection-allowlist-announcement).

HTML previews block network access. Remote scripts, styles, images, fonts, frames, requests, DNS prefetch, and WebRTC cannot supply preview content. The preview cannot access app data, host commands, credentials, app storage, local files, or clipboard contents. It cannot navigate the app, open another window, or start a download. A user's deliberate paste, drop, or file selection inside the preview can supply content without granting automatic access to the clipboard or filesystem.

In the tested Chromium 152 and 155 runtimes, constructing a WebRTC connection can stop the isolated preview frame. The app remains open, but the preview cannot recover from this runtime failure. Remove the WebRTC call from the file or download the original if this occurs.

Both shells load the same constant trusted bootstrap response. It contains no task data or credentials. The response sets `Connection-Allowlist: ()`, a restrictive Content Security Policy, a restrictive Permissions Policy, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`. Browser hosts serve `/artifact-preview-bootstrap` under their configured mount path. Electron serves the fixed response through a dedicated secure protocol.

The bootstrap and its nested HTML frame use `sandbox="allow-scripts"` without same-origin permission. The app sends the selected HTML through a private MessageChannel only after the trusted bootstrap is ready. Each preview generation owns its frames and channel ports. Changing the HTML content, selecting another artifact, or closing the view disposes them. A startup failure reports an error and does not switch to an unrestricted preview.

SVG uses browser image mode, never inline markup or an object document. Scripts and external SVG resources remain disabled. Agent image reads can also request a host preview from the same captured bytes as the original read. The host validates supported raster files and uses a worker to convert SVG or large raster images. Preview output cannot exceed 2 MiB. A failed conversion does not prevent access to the original bytes.

## Task lifecycle

| Action | Workflow artifacts | Free artifacts |
|---|---|---|
| Reset implementation | Keep Specification and Implementation Plan; remove QA reports. | Keep all. |
| Reset task | Remove all. | Remove all. |
| Close task | Keep all and retain workflow editing rules. | Keep all as read-only. |
| Delete task | Remove with the task. | Remove with the task. |

Closed tasks still allow artifact collection reads, previews, and free-artifact downloads. Users and agents cannot create, rename, replace, or delete a free artifact on a closed task. Reopening restores free-artifact changes under the normal task rules.

## Agent access and upgrade requirements

Call `odt_read_task` first for task fields, `qaVerdict`, and metadata for all current workflow and free artifacts. Each metadata entry has a stable `code`, display `name`, and `classification`. Then read content with `odt_read_task_artifacts`, for example `{ "taskId": "repo-123", "codes": ["spec"] }`. The required `codes` array must be nonempty and contain distinct values. Workflow reads return full content by default; free-artifact reads default to 16 KiB.

Use `odt_set_task_artifact` with required `code` to save any artifact. Put complete workflow Markdown directly in `content`. Workflow codes use the fixed `text/markdown` format and also accept UTF-8 Markdown bytes in `dataBase64`. They reject `name`, `fileName`, and `mediaType`. Code `qaReport` also requires an approved or rejected `verdict`. The host checks each managed workflow write against its root session's role. Workflow saves keep their existing status and provenance rules.

For a new free code, the MCP caller chooses the code and supplies `name`, `fileName`, `mediaType`, and either plain text in `content` or base64 file bytes in `dataBase64`. For an existing free code, `name` changes only its display name. A rename omits both content fields. Set returns the metadata captured by that write, without a content copy or a later collection read. Use `odt_delete_task_artifact` with `code` to delete a free artifact; it rejects workflow codes. The MCP tools expose codes instead of internal artifact IDs or `workflowKind`. Session agents still use their assigned task ID, and every artifact operation checks task and workspace ownership. See [external MCP](external-mcp.md#read-and-manage-task-artifacts) for role rules, request formats, and chunk limits.

This release replaces document-named public tools and fields without aliases. `odt_read_task_documents` becomes `odt_read_task_artifacts`. `documentSummary` becomes `artifactSummary`, and task read `documents` becomes `artifacts`. All workflow saves use `odt_set_task_artifact` with a workflow code. Update custom prompt overrides to use the current reader, setter, and code inputs.

The MCP bridge and remote host protocol use version 2. Update the host, clients, and MCP package together. Incompatible peers fail with an update action instead of translating old requests.

The SQLite migration copies workflow content, revisions, timestamps, provenance, and QA verdicts into `tasks_artifacts`, then removes `task_documents`. It preserves workflow Markdown as text and stores free files as BLOBs. All hosts that share an upgraded workspace must use the new schema. An older binary cannot use the migrated database. Downgrade requires a compatible database backup.

The artifact-code migration adds a saved code column and a unique task/code index. It fills codes for existing artifacts and preserves existing artifact data. Update hosts that share the workspace before they use the new schema.
