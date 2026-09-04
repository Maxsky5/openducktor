# Interactive terminal architecture

The host owns each PTY, process tree, and in-memory terminal session. The renderer owns xterm and tab display state.

The app does not store terminal sessions, tabs, or transcripts in settings or SQLite. After a renderer reload, the UI finds terminals that still belong to the same host and attaches again. Host shutdown stops and forgets them.

## Ownership and transport

- `packages/contracts` defines commands, summaries, typed failures, and the binary protocol. A frame has a four-byte big-endian JSON header length, the JSON header, and an optional binary body.
- `packages/host` owns IDs, launch rules, limits, in-memory sessions, output replay, byte order, flow control, titles, and cleanup. PTY adapters implement `TerminalPtyPort`.
- Electron uses `node-pty` over a dedicated preload IPC bridge.
- The web runner uses `Bun.spawn({ terminal })` over one authenticated WebSocket. It checks origin and requires the `openducktor-terminal.v1` subprotocol.
- `packages/frontend/src/features/terminals` owns the shared panel, collection hook, tabs, transport controller, xterm renderer, and input rules. Its transport controller shares one connection across the mounted terminal emulators. Agent Studio only supplies the task worktree and task context.

Create, list, close, and path setup use host commands. Input, resize, attach, detach, ACK, output, lifecycle, and title use terminal frames. Electron and web each provide one PTY adapter. Neither falls back to the other.

## Start a terminal

`workingDir` is required. The host makes it canonical, checks that it is an accessible directory, and saves it as `initialWorkingDir`. Later `cd` commands do not change that field.

The host selects the shell, arguments, and clean child environment. The renderer cannot choose an executable, arguments, or environment variables. On Unix, use the login shell with `TERM=xterm-256color` and `COLORTERM=truecolor`.

A terminal can have no task or have `repoPath` and `taskId`. The host uses this context for lists, limits, and cleanup. It does not restrict file access inside the shell.

The first title is the canonical start directory. The host then reads bounded OSC 0 and OSC 2 title codes without changing PTY output. It cleans and stores the latest title, then sends it in snapshots and title events.

## Attach and replay

The host adds an output consumer before it sends the attachment snapshot. The snapshot has lifecycle, title, first retained byte sequence, and snapshot end sequence. The host then sends retained output followed by live output. Output byte sequences increase monotonically. Exit comes after the final output sequence.

The renderer records the last sequence written to xterm. It sends ACK only after the xterm write callback finishes. On another attach, it sends that sequence so the host sends only missing output.

If the host already dropped the requested range, it sends `replay_gap`. The renderer resets xterm before it applies later output. During first attach, keep xterm hidden until it reaches the snapshot boundary.

Replay and unacknowledged output have byte limits. `node-pty` can pause and resume. An adapter that cannot pause, such as Bun PTY, sends overflow and stops the terminal.

The frontend reconnects the frame transport and attaches mounted terminals again. A transport loss removes attachments, not the PTY. If the host instance changes, old tabs become lost. A stale attach gets `terminal_forgotten`. Do not recreate a lost terminal.

## Close and clean up

Before an unconfirmed close, the host checks for child processes. With no child, it closes at once. With a child, it returns `confirmation_required`. A confirmed close stops the process tree and removes the session.

The UI hides a tab while close is pending. It restores the tab when confirmation is needed or close fails.

Task close, delete, reset, and merged-worktree cleanup take a terminal cleanup lease. They stop task terminals before dev servers, worktrees, branches, or task records. A terminal failure stops later cleanup. The lease blocks a new task terminal during cleanup.

Host shutdown stops admission, stops all PTYs and process trees, then continues host cleanup. An exited session can stay in memory for bounded replay until time or count limits remove it.

Do not persist a PTY handle, PID, route, terminal ID, live state, or transcript. Terminal persistence needs a separate decision about privacy, retention, recovery, and access.

## Keyboard, clipboard, and images

The frontend gets the platform from the host and applies terminal shortcuts. It sends normal input as ordered UTF-8 chunks within the input limit.

Image paste sends the terminal's native paste control so a compatible TUI can read the OS clipboard. Image drag and drop stages each image, asks the host for shell-safe paths, and pastes those paths into xterm. It does not send image bytes through the terminal protocol.

Drag and drop accepts at most eight images, 20 MiB each, and 40 MiB total. An interaction error does not replace the terminal screen. xterm or WebGL startup failure blocks that emulator and appears in its body.

## Limits and security

The host limits terminals per task and host, input bytes, grid size, replay bytes, unacknowledged output, and retained exited sessions. The transports limit frame size and output queues. Each operation uses an opaque terminal ID.

A browser WebSocket upgrade needs the HttpOnly app session, an allowed frontend origin, and the exact protocol name. Invalid direction, frame, or protocol version fails.

Electron keeps `node-pty` as a production dependency. The package excludes its build scripts and unpacks native files from ASAR through Electron Builder. No dependency-specific package script handles terminals.
