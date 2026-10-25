# `@openducktor/mcp`

OpenDucktor MCP server for local workspace task workflows.

The MCP package is a thin client of the running OpenDucktor host.

The published package is intentionally a standalone CLI/server package. It does not expose a supported JavaScript or TypeScript library API from `@openducktor/mcp`.

Desktop-managed sessions launch this same package as a sidecar. In both desktop-managed and standalone use, the package validates `odt_*` inputs and forwards them to the host bridge instead of talking to the SQLite task store directly.

- Desktop-managed launches receive `ODT_HOST_URL` from the host automatically.
- Standalone use auto-discovers the current host bridge from the local discovery file.
- `ODT_HOST_URL` and `--host-url` remain available as explicit overrides.

## Usage

With a startup default workspace:

```json
{
  "mcpServers": {
    "openducktor": {
      "command": "bunx",
        "args": [
          "@openducktor/mcp",
          "--workspace-id", "my-workspace"
        ]
    }
  }
}
```

Without a startup default workspace:

```json
{
  "mcpServers": {
    "openducktor": {
      "command": "bunx",
      "args": [
        "@openducktor/mcp"
      ]
    }
  }
}
```

Optional arguments:

- `--workspace-id <workspace-id>` default workspace for later workspace-scoped calls
- `--host-url <url>`

Equivalent environment variables:

- `ODT_WORKSPACE_ID` optional default workspace
- `ODT_HOST_URL` optional override
- `OPENDUCKTOR_CHANNEL=dev` selects development host discovery; leave it unset for production
- `OPENDUCKTOR_DEV_INSTANCE` selects the exact development instance printed by its dev server

Automatic discovery:

- With `OPENDUCKTOR_CHANNEL` unset, the MCP reads `runtime/mcp-bridge.json` for the production host.
- With `OPENDUCKTOR_CHANNEL=dev`, the MCP requires `OPENDUCKTOR_DEV_INSTANCE` and reads `runtime/dev-instances/<instanceId>/mcp-bridge.json`.
- The MCP rejects empty or unknown channel values during automatic discovery. It never tries the other channel's descriptor.
- Production discovery uses `~/.openducktor`. Development discovery uses `~/.openducktor-dev`.
- Set `OPENDUCKTOR_CONFIG_DIR` to change the config root for the selected descriptor.

Connect to a source development host with:

```sh
OPENDUCKTOR_CHANNEL=dev OPENDUCKTOR_DEV_INSTANCE=<instance-id> bunx @openducktor/mcp@latest
```

Startup behavior:

- The MCP uses `ODT_HOST_URL` or `--host-url` first when provided.
- Otherwise it discovers the current host bridge from the local discovery file.
- It calls authenticated `odt_mcp_ready` before serving requests.
- When a default workspace is configured, it calls `odt_get_workspaces` alongside readiness and requires both calls to succeed.
- The unauthenticated `/health` endpoint remains available for diagnostics, but MCP startup does not call it.
- Startup fails if the host does not expose the full ODT tool surface.
- Startup no longer requires `--workspace-id` or `ODT_WORKSPACE_ID`.
- When both a startup default and a tool-input `workspaceId` are present, the tool input wins.
- Workspace-scoped tools fail fast with an explicit error when neither a startup default nor a tool-input `workspaceId` is available.

OpenDucktor-managed OpenCode and Codex sessions receive explicit host URL and token values. Their routing does not use `OPENDUCKTOR_CHANNEL`.

The OpenDucktor host owns SQLite task-store readiness, workflow transitions, and artifact persistence. This package owns MCP transport and schema validation only.

## Public Tools

- `odt_get_workspaces`
- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_assets`
- `odt_read_task_artifacts`
- `odt_set_task_artifact`
- `odt_delete_task_artifact`
- `odt_update_task`

The remaining `odt_*` mutation tools are intended for OpenDucktor workflow automation and remain available on the same server.

The `odt_browser_*` tools are only for agent sessions that OpenDucktor starts. The server lists them only when `ODT_ALLOWED_TOOLS` names them, so external clients never get them. See [External MCP](../../docs/external-mcp.md#browser-tools).

## `odt_get_workspaces`

Lists the workspaces currently known to the running OpenDucktor host.

Input fields:

- none

Example response:

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

Use `odt_get_workspaces` first when you start the MCP without a default workspace and need to discover the `workspaceId` for later calls.

## `odt_create_task`

Creates a new `task`, `feature`, or `bug`.

Input fields:

- `workspaceId?` optional per-call workspace override
- `title`
- `issueType`
- `priority`
- `description?`
- `labels?`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

## `odt_search_tasks`

Searches active tasks only. Closed tasks are excluded.

Optional filters:

- `workspaceId?` optional per-call workspace override
- `priority`
- `issueType`
- `status`
- `title`
- `tags`
- `limit`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

## `odt_update_task`

Updates an existing task.

Input fields:

- `workspaceId?` optional per-call workspace override
- `taskId`
- `title?`
- `description?`
- `priority?`
- `labels?`
- `issueType?`

Omitted fields keep their stored values. The tool trims `title` and `description`. An empty `description` clears the description. An empty `labels` array clears all labels. `updatedAt` changes only when a value changes.

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

## Output Model

`odt_create_task` and `odt_update_task` return a lightweight public task summary model. `odt_search_tasks` wraps an array of that same summary model in `{ results, limit, totalCount, hasMore }`.

```json
{
  "task": {
    "id": "repo-123",
    "title": "Implement MCP docs",
    "description": "",
    "status": "open",
    "priority": 2,
    "issueType": "task",
    "labels": ["docs"],
    "targetBranch": {
      "remote": "origin",
      "branch": "main"
    },
    "createdAt": "<ISO 8601 timestamp>",
    "updatedAt": "<ISO 8601 timestamp>",
    "workflowArtifacts": {
      "spec": { "present": false },
      "plan": { "present": false },
      "qaReport": { "present": false }
    }
  }
}
```

Use `odt_read_task` first to load the task fields, optional `targetBranch`, and `workflowArtifacts`. Its `task.artifacts` is an array of metadata for all current workflow and free artifacts. Each entry has a stable `code`, display `name`, and `classification`. It contains no artifact content, internal artifact IDs, or `workflowKind`. `workflowArtifacts` lists every artifact that the workflow declares. An absent artifact has `present: false`. A present review also has its `verdict`.

`odt_read_task` input:

- `workspaceId?` optional per-call workspace override
- `taskId`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

`odt_read_task_assets` input:

- `workspaceId?` optional per-call workspace override
- `taskId`
- `assetIds`: 1 to 50 distinct asset UUIDs

Use one call when the requested assets have a raw total of at most 20 MiB. Split only larger sets. The host checks the exact workspace, canonical task, description scope, media type, per-file byte size, and aggregate byte size before reading files. It keeps request order and fails the whole call if any asset is unavailable.

The result contains a short label and a native MCP `image` content block for each asset. It does not expose the private bridge JSON as `structuredContent`, declare an MCP `outputSchema`, or return storage paths and runtime URLs.

### Read and manage task artifacts

After `odt_read_task`, call `odt_read_task_artifacts` with `taskId` and a nonempty array of distinct `codes` from `task.artifacts`. For example, `{ "taskId": "repo-123", "codes": ["spec"] }` reads the full spec in the second call. The workflow codes `spec`, `plan`, and `qaReport` are reserved; these reads return full content by default. Free-artifact reads, such as `codes: ["design-preview"]`, default to 16 KiB. The reader has no metadata-only mode.

Continue one artifact at `nextByteOffset` with `expectedVersion`. Use `maxBytes` to set an explicit chunk size. Text appears in each JSON artifact entry's `content` string, alongside its metadata and read offsets. One JSON text block matches `structuredContent`; no separate raw text bodies follow it. Binary content uses blob resources, and image previews use native image blocks. A batch must fit the 10 MiB serialized MCP response limit, including both JSON representations.

Use `odt_set_task_artifact` with required `code` to save any artifact. The result is `{ artifact }` with the saved public metadata and no content copy.

For workflow codes `spec`, `plan`, and `qaReport`, put complete Markdown directly in `content`. The format is fixed as `text/markdown`; Set also accepts UTF-8 Markdown bytes in `dataBase64`. Workflow codes reject `name`, `fileName`, and `mediaType`. Code `qaReport` also requires an approved or rejected `verdict`; other codes reject `verdict`. Workflow writes keep their existing domain operations, provenance, and status transitions. Build completion still uses `odt_build_completed`.

For free artifacts, `code` selects the saved artifact. If the code does not exist, supply `name`, `fileName`, `mediaType`, and one content field to create it. Use a plain string in `content` for text or padded base64 in `dataBase64` for exact file bytes. Send only one content field. Every content change requires `fileName` and `mediaType`; `mediaType` selects the format. For an existing code, supply `name` to rename it, content fields to replace its content, or both. A rename omits both content fields and needs no current bytes. The decoded limit is 10 MiB. A combined update commits once. Use `odt_delete_task_artifact` with `code` to delete one free artifact. Delete rejects reserved workflow codes.

Free-artifact codes are unique within a task and never change. Display names can repeat, and a rename keeps the code. Display names cannot change workflow roles. Internal artifact IDs stay within the UI and store. Closed tasks permit reads only. Free-artifact writes preserve task status. Managed sessions can save workflow codes only for their root role: Spec writes `spec`, Planner writes `plan`, Builder writes `spec` and `plan`, and QA writes `qaReport`. Every role can write free artifacts. The host checks the native caller; repository sessions and external clients have no workflow role restriction.

The [artifact access contract](https://github.com/Maxsky5/openducktor/blob/main/docs/external-mcp.md#read-and-manage-task-artifacts) defines chunking, exact-byte access, image previews, failures, and transport limits. Bridge version 2 requires compatible clients and hosts. `odt_read_task_documents` has no compatibility alias.
