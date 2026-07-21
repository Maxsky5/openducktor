# External MCP Usage

## Purpose

This document describes the public OpenDucktor MCP package that can be used outside the desktop app.

Both desktop-managed and standalone MCP paths route task operations through the OpenDucktor host. The TypeScript MCP package does not talk to the SQLite task store directly.

- Desktop-managed launches receive `ODT_HOST_URL` from the desktop host automatically.
- Standalone external use auto-discovers the current host bridge from the local discovery file.
- `ODT_HOST_URL` and `--host-url` remain available as explicit overrides.
- Startup fails if the host bridge is unhealthy or does not expose the required ODT tool surface.

The MCP package is transport and validation only. The host remains the owner of SQLite task-store readiness, workflow transitions, and document persistence.

Package name:

- `@openducktor/mcp`

MCP server name:

- `openducktor`

## Basic Configuration

Example MCP config with a startup default workspace:

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

Example MCP config without a startup default workspace:

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

- `--workspace-id <workspace-id>` optional default workspace for later workspace-scoped calls
- `--host-url <url>`

Equivalent environment variables:

- `ODT_WORKSPACE_ID` optional default workspace
- `ODT_HOST_URL` optional override
- `OPENDUCKTOR_CHANNEL=dev` selects development host discovery; leave it unset for production

Automatic discovery:

- With `OPENDUCKTOR_CHANNEL` unset, the MCP reads the production host bridge from `runtime/mcp-bridge.json`.
- With `OPENDUCKTOR_CHANNEL=dev`, the MCP reads the development host bridge from `runtime/mcp-bridge-dev.json`.
- When automatic discovery is used, empty or unknown channel values fail at startup. The MCP does not try the other channel's file.
- The default config directory is `~/.openducktor`.
- `OPENDUCKTOR_CONFIG_DIR`, when set, changes the config root for the selected discovery file.

To connect an external MCP client to `bun run electron:dev` or `bun run browser:dev`:

```sh
OPENDUCKTOR_CHANNEL=dev bunx @openducktor/mcp@latest
```

Startup contract:

1. Resolve an optional startup default workspace from `--workspace-id` or `ODT_WORKSPACE_ID`.
2. Use `ODT_HOST_URL` or `--host-url` first when provided.
3. Otherwise read the local discovery file for the current host bridge URL and token.
4. Validate the discovered host bridge before serving tools.
5. Call the host bridge `/health` endpoint.
6. Call `odt_mcp_ready` through the loopback host API.
7. Refuse startup if any required ODT tool name is missing.
8. Do not implicitly choose a workspace. Workspace-scoped tool calls must resolve a workspace from tool input `workspaceId` first, then the startup default.

Desktop-managed and standalone MCP clients intentionally use this same host-bridge path. The difference is only how the MCP learns the host URL: desktop mode injects it, while standalone mode usually discovers it. Workspace resolution is request-scoped for workspace-bound tools: tool-input `workspaceId` wins over any startup default, and missing both sources is an error.

OpenDucktor-managed OpenCode and Codex sessions receive explicit `ODT_HOST_URL` and `ODT_HOST_TOKEN` values. They do not depend on discovery files or `OPENDUCKTOR_CHANNEL`.

## Public Tools

Public external tools:

- `odt_get_workspaces`
- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_documents`

Internal workflow tools remain on the same MCP server:

- `odt_set_spec`
- `odt_set_plan`
- `odt_build_blocked`
- `odt_build_resumed`
- `odt_build_completed`
- `odt_set_pull_request`
- `odt_qa_approved`
- `odt_qa_rejected`

Current OpenDucktor Spec/Planner/Builder/QA agents must not receive `odt_create_task`, `odt_search_tasks`, or `odt_get_workspaces` in their tool selection.

## Workspace Discovery And Scoping

Use `odt_get_workspaces` when you start the MCP without a default workspace and need to discover the canonical `workspaceId` values known to the host.

`odt_get_workspaces` takes no input and returns the existing shared workspace record shape:

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

Workspace resolution for workspace-scoped tools is deterministic:

1. top-level tool input `workspaceId`
2. startup default workspace resolved once at process startup from `--workspace-id` or `ODT_WORKSPACE_ID`

If no workspace can be resolved, the MCP rejects the call with an actionable error instead of selecting an active or first workspace.

## Shared Response Model

`odt_create_task`, `odt_search_tasks`, and `odt_read_task` reuse the same lightweight public task summary shape:

```json
{
  "task": {
    "id": "repo-123",
    "title": "Implement MCP docs",
    "description": "Document the external MCP surface.",
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

This is a discovery-only summary. Call `odt_read_task` first, then call `odt_read_task_documents` only for the document bodies you actually need.

`qaVerdict` is `"approved"`, `"rejected"`, or `"not_reviewed"`. `not_reviewed` means the task has no persisted QA report yet.

Public MCP task snapshots intentionally do not expose:

- `parentId`
- `availableActions`
- `agentWorkflows`

## `odt_create_task`

Creates a new public task.

Allowed inputs:

- `workspaceId` optional per-call workspace override
- `title` is required
- `issueType` is required: `task | feature | bug`
- `priority` is required: `0 | 1 | 2 | 3 | 4`
- `description` optional
- `labels` optional
- `aiReviewEnabled` optional

Constraints:

- `epic` is rejected at the MCP schema layer.
- Input fields mirror the current desktop create form only.
- When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` is required at call time.

Output:

- `{ task }`

## `odt_read_task`

Reads one persisted task summary.

Input:

- `workspaceId` optional per-call workspace override
- `taskId` required

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` is required at call time.

Output:

```json
{
  "task": {
    "id": "repo-123",
    "title": "Implement MCP docs",
    "description": "Document the external MCP surface.",
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

Call `odt_read_task` first to discover task state, `qaVerdict`, and document availability. Use `odt_read_task_documents` only when you need the actual persisted markdown bodies.

## `odt_search_tasks`

Searches active tasks only.

Optional filters:

- `workspaceId`
- `priority`
- `issueType`
- `status`
- `title`
- `tags`
- `limit`

Search semantics:

- `priority`: exact match
- `issueType`: exact match. Active epics may appear in search results.
- `status`: exact active-status match only
- `title`: case-insensitive substring match
- `tags`: AND semantics, task must contain all provided tags
- `limit`: default `50`, max `100`

Excluded statuses:

- `closed`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` is required at call time.

Output:

```json
{
  "results": [
    {
      "task": {
        "id": "repo-123",
        "title": "Implement MCP docs",
        "description": "Document the external MCP surface.",
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
  ],
  "limit": 50,
  "totalCount": 1,
  "hasMore": false
}
```

## `odt_read_task_documents`

Reads only the requested persisted document bodies.

Input:

- `workspaceId` optional per-call workspace override
- `taskId` required
- `includeSpec` optional boolean
- `includePlan` optional boolean
- `includeQaReport` optional boolean

Constraints:

- Unknown input fields are rejected.
- At least one include flag must be `true`.
- When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` is required at call time.
- Requested document keys are returned consistently even when no persisted body exists yet.
- Missing spec and plan return `{ "markdown": "", "updatedAt": null }`.
- Missing latest QA report returns `{ "markdown": "", "updatedAt": null, "verdict": "not_reviewed" }`.
- Workflow documents are stored as plain markdown in the host-owned task store.
- Successful MCP reads return plain markdown.
- When the latest stored document cannot be decoded, the returned document includes an optional `error` field with an actionable host-supplied message.
- There is no automatic migration of older markdown-only metadata.

Output:

```json
{
  "documents": {
    "spec": {
      "markdown": "",
      "updatedAt": "<ISO 8601 timestamp>",
      "error": "Failed to decode openducktor.documents.spec[0]: invalid base64 payload"
    },
    "implementationPlan": { "markdown": "## Plan", "updatedAt": "<ISO 8601 timestamp>" },
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

## Architecture Notes

- `packages/openducktor-mcp` owns MCP transport, request validation, response validation, and packaging.
- The OpenDucktor host owns SQLite task-store readiness, task reads and writes, workflow transitions, recovery, and canonical document writes.
- The host bridge surface mirrors the MCP tool names so desktop-managed and standalone MCP clients use the same execution path.
- The task store stays modeled as host-owned storage infrastructure. It is not part of the MCP runtime contract beyond the host-owned bridge being healthy.
