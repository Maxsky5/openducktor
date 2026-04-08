# `@openducktor/mcp`

OpenDucktor MCP server for local repository task workflows.

When OpenDucktor launches this MCP from the desktop app it injects the Beads attachment dir and shared Dolt connection details automatically. For standalone use, you must provide the same contract yourself.

## Usage

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

- `create_task`
- `search_tasks`
- `odt_read_task`
- `odt_read_task_documents`

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

`create_task` and `odt_read_task` return the same lightweight public task summary model. `search_tasks` wraps an array of that same summary model in `{ results, limit, totalCount, hasMore }`.

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

Use `odt_read_task` first to discover the task summary object, including task state, `qaVerdict`, and which documents exist. When no QA report exists yet, `qaVerdict` is `"not_reviewed"`.

Use `odt_read_task_documents` only when you need document bodies:

```json
{
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
    "spec": { "markdown": "# Spec", "updatedAt": "<ISO 8601 timestamp>" },
    "latestQaReport": {
      "markdown": "## QA",
      "updatedAt": "<ISO 8601 timestamp>",
      "verdict": "approved"
    }
  }
}
```
