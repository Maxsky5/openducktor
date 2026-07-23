# Task description Markdown

Task descriptions persist one raw Markdown string. Visual editing uses TipTap only while the form is open; the task store never saves TipTap JSON, editor mode, preview URLs, or rendered output.

## Supported source

Visual mode supports headings, emphasis, inline and fenced code, links, lists and task lists, blockquotes, rules, simple GFM tables, images, math, and Mermaid fences. The compatibility check keeps raw HTML, reference links, malformed front matter, and Markdown that cannot make a safe semantic round trip in source mode.

A closed YAML `---` or TOML `+++` block at the start of a description stays outside TipTap. Visual edits reattach that raw prefix without parsing it. Read views omit a valid prefix; copy and source mode keep it.

## Task assets

Markdown stores only `odt-asset:<assetId>` image targets. Before save, the host stages approved PNG, JPEG, WebP, or GIF bytes and returns the final asset ID without a path. Task create and update commands carry staged IDs beside the durable task input.

The asset-aware task store checks the final Markdown, workspace ownership, task ownership, scope, file limits, and registry collisions. It promotes new files and quarantines obsolete files around the SQLite transaction. Failed work restores or removes files where possible and returns a typed partial-state error when cleanup cannot restore a known state.

Durable files live below `task-assets/<workspaceId>/<taskId>/<assetId>` in the OpenDucktor config directory. SQLite stores the task, scope, name, media type, byte size, and creation time. Closing a task keeps its assets. Deleting a task quarantines its asset directory before deleting the task and its registry rows.

## Serving

The shared host read service validates the full workspace, task, scope, and asset relation before reading a derived path. It rejects symlinks and non-files, checks containment and byte size, and serves only registry-approved image media types with private no-store caching and `nosniff`.

The browser route requires the app-session cookie. Electron uses a privileged application protocol. Runtime URLs stay outside Markdown and SQLite.

## Agent access

Workflow agents read description images with `odt_read_task_assets({ taskId, assetIds })`. The caller collects the UUIDs from the description's `odt-asset:<assetId>` targets and sends one non-empty batch of up to 50 distinct IDs. The host resolves the canonical task, enforces the same workspace/task/description-scope ownership checks as UI rendering, and fails the whole call if any requested asset is missing or invalid.

The MCP result keeps request order and returns a short text label followed by a native image content block for each asset. It does not return storage paths, browser URLs, `structuredContent`, or an MCP `outputSchema`. OpenCode, Codex, and Claude-compatible MCP clients can pass those image blocks to their model without a kickoff-message attachment.
