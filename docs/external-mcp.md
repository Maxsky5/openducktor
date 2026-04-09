# External MCP Usage

## Purpose

This document describes the public OpenDucktor MCP package that can be used outside the desktop app.

Both desktop-managed and standalone MCP paths now route task operations through the Rust host. The TypeScript MCP package does not talk to Beads or Dolt directly.

- Desktop-managed launches receive `ODT_HOST_URL` from the desktop host automatically.
- Standalone external use auto-discovers a running host bridge from the local registry.
- `ODT_HOST_URL` and `--host-url` remain available as explicit overrides.
- Startup fails if the host bridge is unhealthy or does not expose the required ODT tool surface.

For the full Beads and shared Dolt lifecycle, including why the Rust host owns that lifecycle, see [beads-shared-dolt-lifecycle.md](beads-shared-dolt-lifecycle.md).

Package name:

- `@openducktor/mcp`

MCP server name:

- `openducktor`

## Basic Configuration

Example MCP config:

```json
{
  "mcpServers": {
    "openducktor": {
      "command": "bunx",
      "args": [
        "@openducktor/mcp",
        "--repo", "/absolute/path/to/repo"
      ]
    }
  }
}
```

Optional arguments:

- `--host-url <url>`
- `--metadata-namespace <name>`

Equivalent environment variables:

- `ODT_REPO_PATH`
- `ODT_HOST_URL` optional override
- `ODT_METADATA_NAMESPACE`

Automatic discovery:

- The MCP reads bridge ports from `runtime/mcp-bridge-ports.json` under the OpenDucktor config directory.
- The default config directory is `~/.openducktor`.
- If `OPENDUCKTOR_CONFIG_DIR` is set, discovery uses `<OPENDUCKTOR_CONFIG_DIR>/runtime/mcp-bridge-ports.json` instead.

Startup contract:

1. Normalize and validate the repo path.
2. Use `ODT_HOST_URL` or `--host-url` first when provided.
3. Otherwise read the local discovery registry and try discovered bridge ports in registry order.
4. The desktop host keeps the current bridge at the front of that registry so discovery prefers the freshest running host.
5. Call the host bridge `/health` endpoint.
6. Call `odt_mcp_ready` through the loopback host API.
7. Refuse startup if any required ODT tool name is missing.

## Public Tools

Public external tools:

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
- `odt_qa_approved`
- `odt_qa_rejected`

Current OpenDucktor Spec/Planner/Builder/QA agents must not receive `odt_create_task` or `odt_search_tasks` in their tool selection.

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
- `assignee`
- `availableActions`
- `agentWorkflows`

## `odt_create_task`

Creates a new public task.

Allowed inputs:

- `title` is required
- `issueType` is required: `task | feature | bug`
- `priority` is required: `0 | 1 | 2 | 3 | 4`
- `description` optional
- `labels` optional
- `aiReviewEnabled` optional

Constraints:

- `epic` is rejected at the MCP schema layer.
- Input fields mirror the current desktop create form only.

Output:

- `{ task }`

## `odt_read_task`

Reads one persisted task summary.

Input:

- `taskId` required

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
- `deferred`

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

- `taskId` required
- `includeSpec` optional boolean
- `includePlan` optional boolean
- `includeQaReport` optional boolean

Constraints:

- Unknown input fields are rejected.
- At least one include flag must be `true`.
- Requested document keys are returned consistently even when no persisted body exists yet.
- Missing spec and plan return `{ "markdown": "", "updatedAt": null }`.
- Missing latest QA report returns `{ "markdown": "", "updatedAt": null, "verdict": "not_reviewed" }`.

Output:

```json
{
  "documents": {
    "spec": { "markdown": "# Spec", "updatedAt": "<ISO 8601 timestamp>" },
    "implementationPlan": { "markdown": "## Plan", "updatedAt": "<ISO 8601 timestamp>" },
    "latestQaReport": {
      "markdown": "## QA",
      "updatedAt": "<ISO 8601 timestamp>",
      "verdict": "approved"
    }
  }
}
```

## Architecture Notes

- `packages/openducktor-mcp` owns MCP transport, request validation, response validation, and packaging.
- The Rust host owns Beads attachment verification, shared Dolt lifecycle, task reads and writes, workflow transitions, recovery, and canonical metadata writes.
- The host bridge surface mirrors the MCP tool names so desktop-managed and standalone MCP clients use the same execution path.
