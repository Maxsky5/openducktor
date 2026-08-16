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
- `--host-token <token>` matching token for `--host-url`

Equivalent environment variables:

- `ODT_WORKSPACE_ID` optional default workspace
- `ODT_HOST_URL` optional override
- `ODT_HOST_TOKEN` matching token for `ODT_HOST_URL`
- `OPENDUCKTOR_CHANNEL=dev` selects development host discovery; leave it unset for production
- `OPENDUCKTOR_DEV_INSTANCE` selects the exact development instance printed by its dev server

Automatic discovery:

- With `OPENDUCKTOR_CHANNEL` unset, the MCP reads the production host bridge from `runtime/mcp-bridge.json`.
- With `OPENDUCKTOR_CHANNEL=dev`, the MCP requires `OPENDUCKTOR_DEV_INSTANCE` and reads the development host bridge from `runtime/dev-instances/<instanceId>/mcp-bridge.json`.
- The MCP rejects empty or unknown channel values during automatic discovery. It does not try the other channel's file.
- The default config directory is `~/.openducktor`.
- Set `OPENDUCKTOR_CONFIG_DIR` to change the config root for the selected discovery file.

To connect an external MCP client to `bun run electron:dev` or `bun run browser:dev`:

```sh
OPENDUCKTOR_CHANNEL=dev OPENDUCKTOR_DEV_INSTANCE=<instance-id> bunx @openducktor/mcp@latest
```

Startup contract:

1. Resolve an optional startup default workspace from `--workspace-id` or `ODT_WORKSPACE_ID`.
2. Use `ODT_HOST_URL` or `--host-url` first when provided, with the matching token from `ODT_HOST_TOKEN` or `--host-token`.
3. Otherwise read the local discovery file for the current host bridge URL and token.
4. Validate the discovered host bridge before serving tools.
5. Call authenticated `odt_mcp_ready` through the loopback host API.
6. When a default workspace is configured, call `odt_get_workspaces` alongside readiness and require both calls to succeed.
7. Refuse startup if any required ODT tool name is missing.
8. Keep `/health` available as an unauthenticated diagnostic endpoint; MCP startup does not call it.
9. Do not implicitly choose a workspace. Workspace-scoped tool calls must resolve a workspace from tool input `workspaceId` first, then the startup default.

Desktop-managed and standalone MCP clients intentionally use this same host-bridge path. The difference is only how the MCP learns the host URL: desktop mode injects it, while standalone mode usually discovers it. Workspace resolution is request-scoped for workspace-bound tools: tool-input `workspaceId` wins over any startup default, and missing both sources is an error.

OpenDucktor-managed OpenCode and Codex sessions receive explicit `ODT_HOST_URL` and `ODT_HOST_TOKEN` values. They do not depend on discovery files or `OPENDUCKTOR_CHANNEL`.

## Public Tools

Public external tools:

- `odt_get_workspaces`
- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_assets`
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

This is a discovery-only summary. Call `odt_read_task` first. Read referenced description images with one `odt_read_task_assets` batch, and call `odt_read_task_documents` only for the document bodies you actually need.

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

Call `odt_read_task` first to discover task state, `qaVerdict`, and document availability. If the description contains `odt-asset:<assetId>` image targets needed for the work, collect the IDs and call `odt_read_task_assets` once. Use `odt_read_task_documents` only when you need the actual persisted markdown bodies.

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

## `odt_read_task_assets`

Reads task-description images as native MCP image content.

Input:

- `workspaceId` optional per-call workspace override
- `taskId` required
- `assetIds` required array of 1 to 50 distinct asset UUIDs

The caller should collect all description images needed for the current work and request them in one call when their raw total is at most 20 MiB. Split only larger sets. The host resolves aliases or titles to the canonical task ID, checks each registry row and the aggregate byte limit before reading files, checks each asset against the exact workspace, task, and `description` scope, and keeps request order. The whole call fails if any ID is missing, belongs to another task or workspace, exceeds a byte limit, or cannot pass the stored media and byte-size checks.

The MCP response contains, for each requested ID:

1. a short text block that identifies the asset, media type, and byte size
2. an `image` block with base64 data and its verified MIME type

The tool has no MCP `outputSchema` and returns no `structuredContent`. This is deliberate: clients receive the image blocks directly instead of preferring a private bridge JSON object. Storage paths, runtime URLs, and registry records never leave the host.

Supported media types:

- `image/png`
- `image/jpeg`
- `image/webp`
- `image/gif`

When the MCP started without `--workspace-id` or `ODT_WORKSPACE_ID`, `workspaceId` is required at call time.

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
- The host bridge uses a validated base64 DTO for task assets; the MCP adapter alone turns it into native image content blocks.
- The task store stays modeled as host-owned storage infrastructure. It is not part of the MCP runtime contract beyond the host-owned bridge being healthy.
