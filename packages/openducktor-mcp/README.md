# `@openducktor/mcp`

OpenDucktor MCP server for local repository task workflows.

The MCP package is a thin client of the running Rust host.

- Desktop-managed launches receive `ODT_HOST_URL` from the host automatically.
- Standalone use auto-discovers a running host bridge from the local registry.
- `ODT_HOST_URL` and `--host-url` remain available as explicit overrides.
- Legacy direct `bd` / `dolt` startup parameters are rejected.

For the full Beads and shared Dolt lifecycle, see `../../docs/beads-shared-dolt-lifecycle.md`.

## Usage

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
- `ODT_METADATA_NAMESPACE` optional, defaults to `openducktor`

Automatic discovery:

- The MCP reads bridge ports from `runtime/mcp-bridge-ports.json` under the OpenDucktor config directory.
- The default config directory is `~/.openducktor`.
- If `OPENDUCKTOR_CONFIG_DIR` is set, discovery uses `<OPENDUCKTOR_CONFIG_DIR>/runtime/mcp-bridge-ports.json` instead.

Startup behavior:

- The MCP uses `ODT_HOST_URL` or `--host-url` first when provided.
- Otherwise it discovers host ports from the local registry and tries them in registry order.
- The desktop host keeps the current bridge at the front of that registry so discovery prefers the freshest running host.
- It checks the host bridge `/health` endpoint.
- It calls `odt_mcp_ready` before serving requests.
- Startup fails if the host does not expose the full ODT tool surface.

## Public Tools

- `odt_create_task`
- `odt_search_tasks`
- `odt_read_task`
- `odt_read_task_documents`

The `odt_*` mutation tools are intended for OpenDucktor workflow automation and remain available on the same server.

## `odt_create_task`

Creates a new `task`, `feature`, or `bug`.

Input fields:

- `title`
- `issueType`
- `priority`
- `description?`
- `labels?`
- `aiReviewEnabled?`

`issueType=epic` is rejected by the MCP schema.

## `odt_search_tasks`

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

- Requested document keys are returned consistently even when no persisted body exists yet.
- Missing spec and plan return empty markdown with `updatedAt: null`.
- Missing latest QA report returns empty markdown with `updatedAt: null` and `verdict: "not_reviewed"`.

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
