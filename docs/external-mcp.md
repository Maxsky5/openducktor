# External MCP Usage

## Purpose

This document describes the public OpenDucktor MCP package that can be used outside the desktop app.

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
      "args": ["@openducktor/mcp", "--repo", "/absolute/path/to/repo"]
    }
  }
}
```

Optional arguments:

- `--beads-dir <path>`
- `--metadata-namespace <name>`

## Public Tools

Public external tools:

- `create_task`
- `search_tasks`
- `odt_read_task`

Internal workflow tools remain on the same MCP server:

- `odt_set_spec`
- `odt_set_plan`
- `odt_build_blocked`
- `odt_build_resumed`
- `odt_build_completed`
- `odt_qa_approved`
- `odt_qa_rejected`

Current OpenDucktor Spec/Planner/Builder/QA agents must not receive `create_task` or `search_tasks` in their tool selection.

## Shared Response Model

`create_task`, `search_tasks`, and `odt_read_task` reuse the same public task snapshot shape:

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
    "createdAt": "<ISO 8601 timestamp>",
    "updatedAt": "<ISO 8601 timestamp>"
  },
  "documents": {
    "spec": { "markdown": "", "updatedAt": null },
    "implementationPlan": { "markdown": "", "updatedAt": null },
    "latestQaReport": { "markdown": "", "updatedAt": null, "verdict": null }
  }
}
```

Public MCP task snapshots intentionally do not expose:

- `parentId`
- `assignee`
- `availableActions`
- `agentWorkflows`

## `create_task`

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

- `{ task, documents }`

## `search_tasks`

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
  "results": [{ "task": {}, "documents": {} }],
  "limit": 50,
  "totalCount": 1,
  "hasMore": false
}
```
