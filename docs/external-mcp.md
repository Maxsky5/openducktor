# External MCP

`@openducktor/mcp` exposes the `openducktor` MCP server outside the desktop app. It validates MCP calls and sends them to the OpenDucktor host. It never reads SQLite directly.

The host owns task-store readiness, task rules, and document writes. Desktop-managed and external MCP clients use the same host bridge.

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
- `OPENDUCKTOR_CONFIG_DIR` replaces the default `~/.openducktor` config root.

## Host discovery

Production discovery reads `runtime/mcp-bridge.json`. Development discovery requires both `OPENDUCKTOR_CHANNEL=dev` and `OPENDUCKTOR_DEV_INSTANCE`, then reads `runtime/dev-instances/<instanceId>/mcp-bridge.json`.

An empty or unknown channel fails. The MCP process does not try another channel. OpenDucktor-managed runtime sessions get `ODT_HOST_URL` and `ODT_HOST_TOKEN` and do not use discovery files.

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
- `odt_read_task_documents`

Workflow tools on the same server:

- `odt_set_spec`
- `odt_set_plan`
- `odt_build_blocked`
- `odt_build_resumed`
- `odt_build_completed`
- `odt_set_pull_request`
- `odt_qa_approved`
- `odt_qa_rejected`

Task-bound Spec, Planner, Builder, and QA sessions do not get `odt_get_workspaces`, `odt_create_task`, or `odt_search_tasks`.

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

`odt_create_task`, `odt_search_tasks`, and `odt_read_task` use this task summary:

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
    "documents": {
      "hasSpec": true,
      "hasPlan": true,
      "hasQaReport": true
    }
  }
}
```

`qaVerdict` is `approved`, `rejected`, or `not_reviewed`. Public summaries omit `parentId`, `availableActions`, and `agentWorkflows`.

Call `odt_read_task` first. It tells the client which documents exist and which images the description refers to. Read only the bodies and images needed for the task.

## Create a task

`odt_create_task` requires `title`, `issueType`, and `priority`.

- `issueType` is `task`, `feature`, or `bug`. MCP rejects `epic`.
- `priority` is an integer from 0 through 4.
- `description`, `labels`, and `aiReviewEnabled` are optional.
- `workspaceId` is optional only when the process has a default workspace.

The result is `{ task }`.

## Read a task

`odt_read_task` requires `taskId`. It also requires `workspaceId` when the process has no default workspace. The result is `{ task }` with the shared summary shape.

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

## Read task documents

`odt_read_task_documents` requires `taskId` and at least one `true` flag:

- `includeSpec`
- `includePlan`
- `includeQaReport`

Unknown fields fail. `workspaceId` is optional only when the process has a default workspace.

A requested key always appears. A missing spec or plan returns empty Markdown and `updatedAt: null`. A missing QA report also returns `verdict: "not_reviewed"`.

The host stores and returns plain Markdown. If it cannot decode the latest stored body, that document gets an optional `error` with a host message. The read does not migrate old metadata.

```json
{
  "documents": {
    "spec": {
      "markdown": "",
      "updatedAt": "<ISO 8601 timestamp>",
      "error": "Failed to decode openducktor.documents.spec[0]: invalid base64 payload"
    },
    "implementationPlan": {
      "markdown": "## Plan",
      "updatedAt": "<ISO 8601 timestamp>"
    },
    "latestQaReport": {
      "markdown": "",
      "updatedAt": null,
      "verdict": "not_reviewed"
    }
  }
}
```

## Ownership

- `packages/openducktor-mcp` owns MCP transport, request and response checks, image-block conversion, and packaging.
- The host owns SQLite readiness, task reads and writes, workflow rules, recovery, and document writes.
- The bridge mirrors MCP tool names so all MCP clients use one execution path.
- The host bridge sends task images as a checked base64 DTO. Only the MCP adapter converts it to image blocks.
