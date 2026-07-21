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

Automatic discovery:

- With `OPENDUCKTOR_CHANNEL` unset, the MCP reads `runtime/mcp-bridge.json` for the production host.
- With `OPENDUCKTOR_CHANNEL=dev`, the MCP reads `runtime/mcp-bridge-dev.json` for a development host.
- When automatic discovery is used, empty or unknown channel values fail. The MCP never tries the other channel's descriptor.
- The default config directory is `~/.openducktor`.
- `OPENDUCKTOR_CONFIG_DIR`, when set, changes the config root for the selected descriptor.

Connect to a source development host with:

```sh
OPENDUCKTOR_CHANNEL=dev bunx @openducktor/mcp@latest
```

Startup behavior:

- The MCP uses `ODT_HOST_URL` or `--host-url` first when provided.
- Otherwise it discovers the current host bridge from the local discovery file.
- It checks the host bridge `/health` endpoint.
- It calls `odt_mcp_ready` before serving requests.
- Startup fails if the host does not expose the full ODT tool surface.
- Startup no longer requires `--workspace-id` or `ODT_WORKSPACE_ID`.
- When both a startup default and a tool-input `workspaceId` are present, the tool input wins.
- Workspace-scoped tools fail fast with an explicit error when neither a startup default nor a tool-input `workspaceId` is available.

OpenDucktor-managed OpenCode and Codex sessions receive explicit host URL and token values. Their routing does not use `OPENDUCKTOR_CHANNEL`.

The OpenDucktor host owns SQLite task-store readiness, workflow transitions, and document persistence. This package owns MCP transport and schema validation only.

## Public Tools

- `odt_get_workspaces`
- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_documents`

The `odt_*` mutation tools are intended for OpenDucktor workflow automation and remain available on the same server.

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
- `aiReviewEnabled?`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

`issueType=epic` is rejected by the MCP schema.

## `odt_search_tasks`

Searches active tasks only. Closed tasks are excluded.
Active epics may appear in search results.

Optional filters:

- `workspaceId?` optional per-call workspace override
- `priority`
- `issueType`
- `status`
- `title`
- `tags`
- `limit`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

## Output Model

`odt_create_task` and `odt_read_task` return the same lightweight public task summary model. `odt_search_tasks` wraps an array of that same summary model in `{ results, limit, totalCount, hasMore }`.

```json
{
  "task": {
    "id": "repo-123",
    "title": "Implement MCP docs",
    "description": "",
    "status": "open",
    "priority": 2,
    "issueType": "task",
    "aiReviewEnabled": true,
    "labels": ["docs"],
    "targetBranch": {
      "remote": "origin",
      "branch": "main"
    },
    "createdAt": "<ISO 8601 timestamp>",
    "updatedAt": "<ISO 8601 timestamp>",
    "qaVerdict": "not_reviewed",
    "documents": {
      "hasSpec": false,
      "hasPlan": false,
      "hasQaReport": false
    }
  }
}
```

Use `odt_read_task` first to discover the task summary object, including task state, optional `targetBranch`, `qaVerdict`, and which documents exist. When no QA report exists yet, `qaVerdict` is `"not_reviewed"`.

`odt_read_task` input:

- `workspaceId?` optional per-call workspace override
- `taskId`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

`odt_read_task_documents` input:

- `workspaceId?` optional per-call workspace override
- `taskId`
- `includeSpec?`
- `includePlan?`
- `includeQaReport?`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` becomes required at call time.

Use `odt_read_task_documents` only when you need document bodies:

- Requested document keys are returned consistently even when no persisted body exists yet.
- Missing spec and plan return empty markdown with `updatedAt: null`.
- Missing latest QA report returns empty markdown with `updatedAt: null` and `verdict: "not_reviewed"`.
- Legacy Beads documents encoded as `gzip-base64-v1` are decoded during the SQLite migration.
- New or updated SQLite workflow documents are stored as `plain_text` markdown by the OpenDucktor host.
- Successful MCP reads return plain markdown from the SQLite task store.

```json
{
  "workspaceId": "my-workspace",
  "taskId": "repo-123",
  "includeSpec": true,
  "includePlan": false,
  "includeQaReport": true
}
```

It returns only the requested sections:

```json
{
  "documents": {
    "spec": {
      "markdown": "",
      "updatedAt": "<ISO 8601 timestamp>",
      "error": "Failed to decode openducktor.documents.spec[0]: invalid base64 payload"
    },
    "latestQaReport": {
      "markdown": "",
      "updatedAt": "<ISO 8601 timestamp>",
      "verdict": "approved",
      "error": "Failed to decode openducktor.documents.qaReports[0]: invalid gzip payload"
    }
  }
}
```

`error` is optional. It is omitted for healthy documents and for documents that do not exist yet.
