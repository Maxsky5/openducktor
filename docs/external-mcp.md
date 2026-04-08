# External MCP Usage

## Purpose

This document describes the public OpenDucktor MCP package that can be used outside the desktop app.

Desktop-managed MCP launches receive the Beads attachment path and shared Dolt connection details from the host automatically. Standalone external use must provide those values explicitly.

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
        "--repo", "/absolute/path/to/repo",
        "--beads-attachment-dir", "/absolute/path/to/openducktor/beads/<repo-id>/.beads",
        "--dolt-host", "127.0.0.1",
        "--dolt-port", "3310",
        "--database-name", "odt_repo_deadbeefcafe"
      ]
    }
  }
}
```

Optional arguments:

- `--beads-attachment-dir <path>`
- `--dolt-host <host>`
- `--dolt-port <port>`
- `--database-name <name>`
- `--metadata-namespace <name>`

## Public Tools

Public external tools:

- `create_task`
- `search_tasks`
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

Current OpenDucktor Spec/Planner/Builder/QA agents must not receive `create_task` or `search_tasks` in their tool selection.

## Shared Response Model

`create_task`, `search_tasks`, and `odt_read_task` reuse the same lightweight public task summary shape:

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
