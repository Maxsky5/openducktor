# External MCP

`@openducktor/mcp` exposes the `openducktor` MCP server outside the desktop app. It validates MCP calls and sends them to the OpenDucktor host. It never reads SQLite directly.

The host owns task-store readiness, task rules, and artifact writes. Desktop-managed and external MCP clients use the same host bridge.

## Configure a client

Set a default workspace when one client will use one workspace:

```json
{
  "mcpServers": {
    "openducktor": {
      "command": "bunx",
      "args": ["@openducktor/mcp", "--workspace-id", "my-workspace"]
    }
  }
}
```

Omit `--workspace-id` when each tool call will supply `workspaceId`:

```json
{
  "mcpServers": {
    "openducktor": {
      "command": "bunx",
      "args": ["@openducktor/mcp"]
    }
  }
}
```

Arguments:

- `--workspace-id <workspace-id>` sets the default workspace.
- `--host-url <url>` replaces host discovery.
- `--host-token <token>` supplies the token for `--host-url`.

Environment variables:

- `ODT_WORKSPACE_ID` sets the default workspace.
- `ODT_HOST_URL` replaces host discovery.
- `ODT_HOST_TOKEN` supplies the token for `ODT_HOST_URL`.
- `OPENDUCKTOR_CHANNEL=dev` selects development discovery. Leave it unset for production.
- `OPENDUCKTOR_DEV_INSTANCE` selects the development instance printed by its server.
- `OPENDUCKTOR_CONFIG_DIR` changes the config root for the selected scope. Production defaults to `~/.openducktor`. Development defaults to `~/.openducktor-dev`.

## Host discovery

The host starts the bridge and writes the discovery file during host startup. If this fails, the host logs the cause and continues to start runtimes. The host publishes each bridge state (`starting`, `ready`, or `failed`) on `openducktor://runtime-changed`, and Diagnostics shows it with the cause of a failure. Operations that need the bridge fail with the same cause. The host does not try to start the bridge again. Fix the cause, then restart OpenDucktor.

Production discovery reads `runtime/mcp-bridge.json`. Development discovery requires both `OPENDUCKTOR_CHANNEL=dev` and `OPENDUCKTOR_DEV_INSTANCE`, then reads `runtime/dev-instances/<instanceId>/mcp-bridge.json`.

An empty or unknown channel fails. The MCP process does not try another channel. OpenDucktor-managed runtime sessions get `ODT_HOST_URL` and `ODT_HOST_TOKEN` and do not use discovery files.

A managed session gets its `ODT_WORKSPACE_ID` from the server configuration of that session or directory, not from the shared runtime process. The [runtime integration guide](runtime-integration-guide.md#workspace-binding-of-openducktor-tools) describes the binding for each runtime.

Connect a client to a development server with:

```sh
OPENDUCKTOR_CHANNEL=dev OPENDUCKTOR_DEV_INSTANCE=<instance-id> bunx @openducktor/mcp@latest
```

## Startup

1. Read the default workspace from `--workspace-id` or `ODT_WORKSPACE_ID`.
2. Use an explicit host URL and token when present. Otherwise, read the selected discovery file.
3. Check the host bridge.
4. Call authenticated `odt_mcp_ready`.
5. When a default workspace exists, call `odt_get_workspaces` at the same time and require both calls to succeed.
6. Check that every required ODT tool is present.
7. Start MCP stdio only after all checks pass.

`/health` is an unauthenticated diagnostic route. MCP startup does not use it.

The process does not choose an active or first workspace. A tool uses its `workspaceId` first, then the startup default. If neither exists, the call fails.

## Tool access

Public tools:

- `odt_get_workspaces`
- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_assets`
- `odt_read_task_artifacts`
- `odt_set_task_artifact`
- `odt_delete_task_artifact`
- `odt_update_task`

Workflow tools on the same server:

- `odt_build_blocked`
- `odt_build_resumed`
- `odt_build_completed`
- `odt_set_pull_request`

Task-bound sessions with the Spec Agent, Planner Agent, Builder Agent, or QA Agent role do not get `odt_get_workspaces`. They can call `odt_create_task`, `odt_search_tasks`, and `odt_update_task` in their startup workspace and omit `workspaceId`. `odt_update_task` is the only task-bound tool that may target a task other than the session task.

`odt_set_task_artifact` saves both workflow and free artifacts. Managed workflow sessions can write only the workflow codes assigned to their root role:

| Role | Workflow codes |
|---|---|
| Spec | `spec` |
| Planner | `plan` |
| Builder | `spec`, `plan` |
| QA | `qaReport` |

Every role can write free artifacts. The host resolves the native caller to its root session before checking workflow codes. Repository sessions and external clients have no workflow role restriction. See [artifact actions](task-workflow-actions.md#artifact-actions) for revision and approval rules.

External clients do not get the `odt_browser_*` tools. [Browser tools](#browser-tools) describes them.

## Tool listing

The tool list keeps tool descriptions short, because runtimes send the whole list to the model.

- `annotations.readOnlyHint: true` marks the tools that change nothing. A client can run them without an approval.
- A server that forbids `workspaceId` input hides `workspaceId` in the tool schemas. It sends no server instructions, because Codex repeats them in front of each tool description. Other servers send one sentence about `workspaceId`.
- The listed input and output schemas omit the `$schema` URL, UUID patterns, and size limits. The server still checks each input with the full schema.

## Browser tools

The `odt_browser_*` tools let an agent use the browser tabs of its task or Workspace Session. Only sessions that OpenDucktor starts get them. These are Spec, Planner, Builder, QA, and Workspace Sessions on OpenCode, Codex, and Claude. [Browser tabs](browser-tabs.md#agent-tools) describes how the host runs them.

- `odt_browser_list`, `odt_browser_open`, `odt_browser_navigate`, and `odt_browser_close` manage tabs.
- `odt_browser_snapshot` reads the accessibility tree of a tab with element refs.
- `odt_browser_click`, `odt_browser_hover`, `odt_browser_type`, `odt_browser_press`, `odt_browser_select`, and `odt_browser_scroll` act on a tab.
- `odt_browser_screenshot`, `odt_browser_console`, `odt_browser_wait`, and `odt_browser_dialog` read the page, wait for it, or answer a JS dialog.

The server lists a browser tool only when `ODT_ALLOWED_TOOLS` names it. A client without `ODT_ALLOWED_TOOLS` gets every other tool. Managed runtimes always set `ODT_ALLOWED_TOOLS`.

The host finds the task or Workspace Session of a call from the runtime session that made it. Tool input never selects it. The MCP server reads the calling session from the runtime.

| `ODT_RUNTIME_KIND` | Calling session |
|---|---|
| `opencode` | `_meta["ai.opencode/sessionID"]` of each `tools/call` request. One MCP process serves all sessions of a directory. |
| `codex` | `_meta.threadId` of each `tools/call` request. Codex `core/src/mcp_tool_call.rs` adds it to every model tool call. |
| `claude` | `ODT_RUNTIME_SESSION_ID` of the MCP process. Claude starts one MCP process for each session and sends no session ID with a call. |

- A call without a calling session fails with an error that says that browser tools need a managed OpenDucktor session.
- The host follows the live parent links of a subagent session to its root session.
- The root session must belong to a task or to an active Workspace Session of the call workspace, with the same runtime kind. Otherwise the call fails with `browser_unmanaged_caller`.

The bridge request body is the tool input plus `workspaceId` and `caller: { runtime, runtimeSessionId }`. Browser calls wait up to 35 seconds for the host, which ends each call within 30 seconds. Other tools wait up to 10 seconds.

Browser tools have no MCP `outputSchema` or `structuredContent`. The result has text blocks and, for `odt_browser_screenshot`, an `image` block. A browser failure returns its message to the agent. `details.browserFailure.code` keeps the browser failure code.

## List workspaces

Call `odt_get_workspaces` when the process has no default workspace or when the client needs canonical workspace IDs. The tool takes no input.

```json
{
  "workspaces": [
    {
      "workspaceId": "my-workspace",
      "workspaceName": "My Workspace",
      "repoPath": "/Users/maxsky5/code/my-repo",
      "isActive": true,
      "hasConfig": true,
      "configuredWorktreeBasePath": null,
      "defaultWorktreeBasePath": null,
      "effectiveWorktreeBasePath": null
    }
  ]
}
```

## Task summary

`odt_create_task`, `odt_search_tasks`, and `odt_update_task` use this task summary:

```json
{
  "task": {
    "id": "repo-123",
    "title": "Implement MCP docs",
    "description": "Document the external MCP tools.",
    "status": "ai_review",
    "priority": 2,
    "issueType": "task",
    "aiReviewEnabled": true,
    "labels": ["docs", "mcp"],
    "createdAt": "<ISO 8601 timestamp>",
    "updatedAt": "<ISO 8601 timestamp>",
    "qaVerdict": "approved",
    "artifacts": {
      "hasSpec": true,
      "hasPlan": true,
      "hasQaReport": true
    }
  }
}
```

`qaVerdict` is `approved`, `rejected`, or `not_reviewed`. Public summaries omit `parentId`, `availableActions`, and `agentWorkflows`.

`odt_read_task` returns the same task fields and `qaVerdict`, with an `artifacts` metadata array instead of presence flags. Call it first to find current workflow and free artifacts and the images that the description refers to. Read only the content and images needed for the task.

## Create a task

`odt_create_task` requires `title`, `issueType`, and `priority`.

- `issueType` is `task`, `feature`, or `bug`. MCP rejects `epic`.
- `priority` is an integer from 0 through 4.
- `description`, `labels`, and `aiReviewEnabled` are optional.
- `workspaceId` is optional only when the process has a default workspace.

The result is `{ task }`.

## Read a task

`odt_read_task` requires `taskId`. It also requires `workspaceId` when the process has no default workspace. The result is `{ task }` with task fields, `qaVerdict`, and an `artifacts` array of all current workflow and free artifact metadata. Each entry has a stable `code`, display `name`, and `classification`. Free metadata also has `fileName`, `mediaType`, and `byteSize`. The result omits content, old workflow revisions, description images, internal artifact IDs, and `workflowKind`.

## Update a task

`odt_update_task` changes task fields. It requires `taskId` and accepts only the fields to change:

- `title`
- `description`
- `priority`
- `labels`
- `issueType`
- `aiReviewEnabled`

The input is a patch. An omitted field keeps its stored value. A null value fails. The tool never changes `status`, `parentId`, `targetBranch`, or artifacts.

Clearing uses typed values:

- An empty `description` clears the description.
- An empty `labels` array clears all labels.
- `aiReviewEnabled: false` turns QA review off.

`title` must not be empty. The tool trims `title` and `description`. `priority` is an integer from 0 through 4. Each label must contain a non-whitespace character. The store drops repeats and sorts labels before it saves them. `issueType` is `task`, `feature`, or `bug`. The tool rejects epic targets and epic conversions. A task can change between `task`, `feature`, and `bug` and keeps its status.

A call with no fields other than `taskId` and optional `workspaceId` succeeds and changes nothing. `updatedAt` changes only when a field value changes. Repeating stored values changes nothing.

A description that references an image the task does not own fails and writes nothing. The store quarantines images the new description no longer references.

Unknown fields fail. `workspaceId` is optional only when the process has a default workspace. The result is `{ task }` with the shared summary shape.

## Search tasks

`odt_search_tasks` returns active tasks. It does not return `closed` tasks.

Optional filters:

- `workspaceId`
- `priority`, exact match
- `issueType`, exact match
- `status`, exact active status
- `title`, case-insensitive substring
- `tags`, all tags must match
- `limit`, default 50 and maximum 100

Active epics can appear in results. `workspaceId` is optional only when the process has a default workspace.

```json
{
  "results": [{ "task": { "id": "repo-123", "title": "Implement MCP docs" } }],
  "limit": 50,
  "totalCount": 1,
  "hasMore": false
}
```

Each result has the full shared task summary.

## Read task images

`odt_read_task_assets` reads description images as MCP image blocks. It requires `taskId` and 1 through 50 unique asset UUIDs. It also requires `workspaceId` when the process has no default workspace.

Send one call when the raw images total at most 20 MiB. Split a larger set. The host checks every asset and the total size before it reads any file. It also checks workspace, task, `description` scope, media type, stored size, and request order. One bad ID fails the full call.

For each ID, the MCP response contains a short text block and an `image` block with base64 data and a checked MIME type. Supported types are PNG, JPEG, WebP, and GIF.

The tool has no MCP `outputSchema` or `structuredContent`. It does not return storage paths, runtime URLs, or registry rows.

## Read and manage task artifacts

Use two calls to read task content. First call `odt_read_task` for task fields, `qaVerdict`, and metadata for all current workflow and free artifacts. Then call `odt_read_task_artifacts` with a required `codes` array. The array must be nonempty and contain distinct codes from `task.artifacts`. The reader has no metadata-only mode.

For example, Planner can read the full spec in the second call:

```json
{ "taskId": "repo-123", "codes": ["spec"] }
```

The workflow codes `spec`, `plan`, and `qaReport` are reserved. Builder can request `["spec", "plan"]` in one call, or include a free-artifact code such as `design-preview`. Workflow reads return full content by default; free-artifact reads default to 16 KiB. Each free-artifact code is unique within its task and never changes. Free codes use lowercase letters and digits, with single hyphens between groups. They start with a letter and contain at most 128 characters. Display names can repeat, and a rename keeps the code. A free artifact named "Specification" remains free. Internal artifact IDs stay within the UI and store; the MCP tools do not accept or return them.

`maxBytes` accepts 4 through 1,048,576 bytes per artifact. `byteOffset` and `expectedVersion` require exactly one selected code. Continue at `nextByteOffset` with the returned `version` as `expectedVersion`. A changed version fails the read; start again before combining content. A missing code fails the call.

The result contains an `artifacts` array in request order. Each entry has `artifact` metadata, `version`, `byteOffset`, `nextByteOffset`, and `totalBytes`. Valid UTF-8 text appears in that entry's `content` string, with its code and media type in `artifact`. The response has one JSON text block and the same object in `structuredContent`, without separate raw text bodies. Text reads preserve the BOM and line endings. Binary content uses an embedded blob resource whose URI identifies the artifact, version, and byte range. Invalid UTF-8 returns exact bytes in a blob resource and a decoding error message. One failed artifact read fails the call.

A complete PNG, JPEG, WebP, or GIF read returns the original bytes once as a native image block. A partial image read returns a blob resource with its byte range, never a native image block. Increase `maxBytes` within the input limit to read a complete image when it fits. Valid UTF-8 SVG source appears in `content` with the original `image/svg+xml` media type and an exact-byte blob resource. Reads preserve UTF-8 character boundaries, the BOM, line endings, and Unicode. Invalid SVG text returns a decoding error and the original byte resource. Reads do not decode, resize, re-encode, or convert images. Limits produce errors or versioned byte chunks, without changing the bytes.

All four workflow roles can create, rename, replace, and delete free artifacts. These actions never change task status or QA verdict. Workflow writes use the same setter and follow role and lifecycle rules. Closed tasks permit reads only.

| Tool | Fields after `taskId` | Result |
|---|---|---|
| `odt_set_task_artifact` | Required `code`; optional `name`, `fileName`, `mediaType`, `content`, `dataBase64`, `verdict`. | `{ artifact }` with saved metadata. |
| `odt_delete_task_artifact` | `code` | Deleted code and event cursor. |

For `spec`, `plan`, and `qaReport`, put the complete Markdown text directly in `content`. The format is fixed as `text/markdown`. Set also accepts the Markdown's UTF-8 bytes through `dataBase64`. It rejects `name`, `fileName`, and `mediaType`. A `qaReport` write also requires `verdict: "approved"` or `verdict: "rejected"`. Other codes reject `verdict`. Workflow saves keep the existing domain operations, provenance, and status transitions. Build completion still uses `odt_build_completed`.

```json
{
  "taskId": "repo-123",
  "code": "qaReport",
  "content": "# QA report\n\nThe change meets the requirements.",
  "verdict": "approved"
}
```

For a free code that does not exist, Set creates an artifact and requires `name`, `fileName`, `mediaType`, and one content field. The caller chooses its code. If the code exists, Set changes its content, renames it with `name`, or does both. A rename needs no file fields or current bytes. A content update requires `fileName`, `mediaType`, and either `content` or `dataBase64`; omitting `name` keeps the current display name. `mediaType` selects the format, such as `text/markdown`, `text/html`, or `image/png`. A combined rename and content update commits once, with one revision and one event. A request must rename the artifact or supply content. File fields alone fail. Delete requires an existing free-artifact code and rejects workflow codes.

Use a plain string in `content` for text or padded base64 in `dataBase64` for exact file bytes. Send only one content field. Omit both fields for a free-artifact rename. The decoded limit is 10 MiB. Reject invalid Unicode text or base64; no replacement characters or silent truncation are permitted. Replacement keeps the identity and retains the last saved name and content if the request fails.

Set returns `{ artifact }` with the saved artifact's public metadata, including its classification, code, name, media type, revision, and update time. It does not copy the content into the response.

Artifact ownership checks require the requested workspace and task. Managed setter calls also require the native caller's root session and enforce its workflow role. Task agents must still use their locked session task. The removed specialized workflow writers have no aliases.

The MCP bridge and remote protocol use version 2. Update incompatible clients and hosts together. The removed `odt_read_task_documents` tool has no alias. Custom prompt overrides remain user-owned and must use the new tool names.

The MCP stdio input cap is 64 MiB to accept escaped text within the decoded limit. The adapter sends content as base64 to the host. Set bridge requests have a 16 MiB envelope; other requests keep their 1 MiB limit. Each artifact response stays below 10 MiB of serialized JSON-RPC bytes, including all requested artifacts, without truncating original content. If a response exceeds the limit, request fewer artifacts or a smaller `maxBytes` value.

## Ownership

- `packages/openducktor-mcp` owns MCP transport, request and response checks, image-block conversion, the calling session of browser tools, and packaging.
- The host owns SQLite readiness, task reads and writes, workflow rules, recovery, artifact writes, and the owner of each browser tool call.
- The bridge mirrors MCP tool names so all MCP clients use one execution path.
- The host bridge sends task images as a checked base64 DTO. Only the MCP adapter converts it to image blocks.
