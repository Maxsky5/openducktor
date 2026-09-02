# Task description Markdown

The task store saves one raw Markdown string for each task description. TipTap exists only while the visual editor is open. The task store does not save TipTap JSON, editor mode, preview URLs, or rendered HTML.

## Supported Markdown

Visual mode supports headings, emphasis, inline and fenced code, links, lists, task lists, blockquotes, rules, simple GFM tables, images, math, and Mermaid fences.

The editor stays in source mode for raw HTML, reference links, malformed front matter, or Markdown that cannot make a safe semantic round trip.

A closed YAML `---` or TOML `+++` block can start a description. TipTap does not parse it. A visual edit attaches the unchanged block to the edited body. Read views hide a valid block. Copy and source mode keep it.

## Task assets

Markdown stores an image as `odt-asset:<assetId>`. Before save, the host stages approved PNG, JPEG, WebP, or GIF bytes and returns the asset ID. Task create and update commands send staged IDs with the task input.

The task store checks the final Markdown, workspace, task, scope, file limits, and registry collisions. It promotes new files and quarantines old files around the SQLite transaction. If cleanup cannot restore a known state, it returns a typed partial-state error.

Files live at `task-assets/<workspaceId>/<taskId>/<assetId>` under the OpenDucktor config directory. SQLite stores the task, scope, name, media type, byte size, and creation time. Closing a task keeps its assets. Deleting a task quarantines its asset directory before it deletes the task and registry rows.

Each host has an owner directory for staging and quarantine. Startup skips live owners, restores quarantines from dead owners, clears their staging files, and removes empty dead-owner state. Shutdown clears the current staging area. A later startup clears files left by a crash. There is no cleanup timer or polling loop. Invalid owner or quarantine data stops recovery and stays on disk for inspection.

## Serving assets

The host read service checks the workspace, task, scope, and asset row before it builds a path. It rejects symlinks and non-files. It also checks path containment, byte size, and image media type. Responses use private no-store caching and `nosniff`.

The browser route requires the app-session cookie. Electron uses a privileged app protocol. Markdown and SQLite do not store runtime URLs.

## Agent access

A workflow agent calls `odt_read_task_assets({ taskId, assetIds })`. It gets UUIDs from the description's `odt-asset:<assetId>` values.

Send one non-empty batch of at most 50 unique IDs when the raw data is at most 20 MiB. Split a larger set. The host checks the task and every asset before it reads a file. One missing or invalid asset fails the full call.

The result keeps request order. It returns a short label and one native image block for each asset. It does not return file paths, browser URLs, `structuredContent`, or an MCP `outputSchema`.
