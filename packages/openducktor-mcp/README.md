# `@openducktor/mcp`

OpenDucktor MCP server for local repository task workflows.

## Usage

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

- `create_task`
- `search_tasks`
- `odt_read_task`

The `odt_*` mutation tools are intended for OpenDucktor workflow automation and remain available on the same server.

## `create_task`

Creates a new `task`, `feature`, or `bug`.

Input fields:

- `title`
- `issueType`
- `priority`
- `description?`
- `labels?`
- `aiReviewEnabled?`

`issueType=epic` is rejected by the MCP schema.

## `search_tasks`

Searches active tasks only. Closed and deferred tasks are excluded.
Active epics may appear in search results.

Optional filters:

- `priority`
- `issueType`
- `status`
- `title`
- `tags`
- `limit`

## Output Model

`create_task` and `odt_read_task` return the same public task snapshot model. `search_tasks` wraps an array of that same snapshot model in `{ results, limit, totalCount, hasMore }`.

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
