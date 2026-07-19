# Interactive terminal architecture

Interactive terminals are transient resources owned by the host process. The host owns each PTY, its process tree, and its in-memory session state. The renderer owns the xterm instances and transient terminal presentation state.

Terminal sessions, tab state, and transcripts are not stored in settings or in the SQLite task store. After a renderer reload, the UI rediscovers and reattaches to terminals that still belong to the same running host. Stopping the app or host terminates and forgets them.

## Components and boundaries

- `packages/contracts` defines terminal commands, summaries, typed failures, and the versioned binary protocol. Each frame contains a four-byte big-endian length for the JSON header, the JSON header itself, and an optional binary payload.
- `packages/host` owns terminal IDs, launch policy, admission limits, the in-memory session registry, output replay, byte sequencing, flow control, title tracking, and cleanup. Runtime-specific PTY implementations use the `TerminalPtyPort` interface.
- Electron uses `node-pty` and carries terminal frames over a dedicated preload IPC bridge.
- The browser runner uses `Bun.spawn({ terminal })` and carries frames over one authenticated, origin-checked, multiplexed WebSocket with the `openducktor-terminal.v1` subprotocol.
- `packages/frontend/src/features/terminals` contains the reusable terminal panel, collection hook, tab presentation state, transport controller, xterm renderer, and input policies. Agent Studio uses a thin adapter that resolves the selected task worktree and supplies its task context to this module. The transport controller shares one connection across the mounted terminal emulators.

Create, list, close, and path-preparation requests use the normal host command interface. Interactive input, resize, attach, detach, ACK, output, lifecycle, and title messages use the terminal frame transport. Electron and the browser runner compose their PTY adapters explicitly; neither transport falls back to another adapter.

## Launch and terminal context

`workingDir` is required when creating a terminal. The host canonicalizes the path, verifies that it is an accessible directory, and records it as `initialWorkingDir`. This field is the launch directory, not the shell's current directory after later `cd` commands.

The host chooses the shell, arguments, and sanitized child-process environment. The renderer cannot provide an executable, arguments, or environment variables. On Unix-like systems, terminals use the user's login shell with `TERM=xterm-256color` and `COLORTERM=truecolor`.

A terminal can be unassociated or include a task context containing `repoPath` and `taskId`. The context is used for listing, limits, and cleanup. It does not restrict filesystem access inside the shell.

The initial terminal title is the canonical launch directory. The host then observes bounded OSC 0 and OSC 2 title sequences without changing the PTY output. It sanitizes the latest title, stores it in the in-memory summary, and sends it in attachment snapshots and live title events. The renderer uses this host-provided title instead of deriving a second title from terminal output.

## Attachment, replay, and flow control

Attaching adds the renderer as an output consumer before sending a snapshot. The snapshot contains the current lifecycle, title, earliest retained sequence, and snapshot end sequence. The host then sends the retained output followed by live output. Output bytes use monotonically increasing sequence ranges, and exit is emitted after the final output sequence has been published.

The renderer records the last sequence consumed by xterm. An ACK is sent only after xterm's write callback completes. On reattachment, the renderer provides that sequence so the host sends only the required retained output. If the requested range has already been discarded, the host sends a `replay_gap` event and the renderer resets the emulator before continuing.

During initial attachment, the terminal remains hidden until xterm has consumed output through the snapshot boundary. This rebuilds the current screen without exposing replay as a visible animation.

Replay and unacknowledged output are byte-bounded. The `node-pty` adapter pauses and resumes output when consumers fall behind. An adapter that cannot pause output, such as the Bun PTY adapter, emits an overflow event and terminates the terminal instead of buffering without a limit.

The frontend reconnects the frame transport automatically and reattaches mounted terminals. A transport disconnect only removes the affected attachments; it does not terminate or recreate the PTY. If the host instance changes while the renderer still holds terminal tabs, those tabs are marked as lost. A stale attach receives `terminal_forgotten`. Lost terminals are never recreated automatically.

## Lifecycle and cleanup

Closing a terminal without confirmation first checks whether its PTY has child processes. If no child process is running, the terminal closes without prompting. If a child process is running, the host returns `confirmation_required`; a confirmed close terminates the process tree and removes the session. The UI hides a tab while close is pending and restores it if confirmation is required or the close fails.

Task close, delete, reset, and merged-worktree cleanup acquire a terminal cleanup lease and terminate the associated terminals before stopping dev servers or removing worktrees, branches, and task records. A terminal cleanup failure stops the remaining cleanup. The lease also prevents a new terminal from being admitted for that task while cleanup is in progress.

Host shutdown stops terminal admission, terminates all PTYs and their process trees, and then continues normal host teardown. Exited sessions may remain in host memory for bounded replay and inspection, but they are removed after the retention limit or when the retained-session limit is reached.

No PTY handle, PID, route, terminal ID, live interaction state, or transcript is persisted. Adding terminal persistence would require a separate decision covering privacy, retention, recovery, and access control.

## Keyboard, clipboard, and image input

The frontend reads the platform from the host and applies platform-specific terminal shortcuts. Normal terminal input is UTF-8 encoded and sent in ordered chunks within the protocol input limit.

Clipboard image paste sends the terminal's native paste control input so compatible TUIs can read the image from the operating-system clipboard. Image drag and drop follows a different path: the renderer stages each image as a local attachment, asks the host to format shell-safe paths for the terminal's shell, and pastes those paths into xterm. Image bytes are not sent through the terminal protocol.

Drag and drop accepts at most eight images, 20 MiB per image, and 40 MiB in total. Interaction failures are reported without replacing the terminal screen. Renderer initialization or WebGL failure is blocking for that emulator and is shown in the terminal body.

## Limits and transport security

The host limits live terminals per task and per host, input size, grid dimensions, replay bytes, unacknowledged output, and retained exited sessions. The transports also limit frame size and outbound queues. Every operation uses an opaque terminal ID.

Browser WebSocket upgrades require the established HttpOnly app session, an allowed frontend origin, and the exact terminal protocol subprotocol. Invalid directions, malformed frames, and unsupported protocol versions fail explicitly.

Electron keeps `node-pty` as a production dependency, excludes its build scripts from the package, and unpacks its native files from ASAR through Electron Builder configuration. The terminal feature does not use a dependency-specific packaging script.
