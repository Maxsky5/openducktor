# Terminal architecture

The shared host terminal engine owns each byte stream, headless screen, replay window, attachment, and output limit. Each terminal session uses a PTY producer that owns its native process. The renderer owns xterm and tab display state.

The PTY handle implements `TerminalProducerHandle` for output pause, resume, and termination, and `TerminalPtyHandle` for input, native resize, and child-process inspection. All terminals are interactive.

The terminal panel loads the shared viewport through `React.lazy`. The transport remains outside the loading boundary. The viewport attaches to the host when it mounts.

The app does not store terminal sessions, tabs, or transcripts in settings or SQLite. After a renderer reload, the UI finds terminals that still belong to the same host and attaches again. Host shutdown stops and forgets them.

## Ownership and transport

- `packages/contracts` defines commands, summaries, typed failures, and the binary protocol. A frame has a four-byte big-endian JSON header length, the JSON header, and an optional binary body.
- `packages/host` owns IDs, launch rules, limits, in-memory sessions, output replay, byte order, flow control, titles, and cleanup. PTY adapters implement `TerminalPtyPort`.
- Electron uses the shared `node-pty` adapter over a dedicated preload IPC bridge.
- The Node web runner uses the same `node-pty` adapter over one authenticated WebSocket. It checks origin and requires the `openducktor-terminal.v2` subprotocol.
- `packages/frontend/src/features/terminals` owns the shared panel, collection hook, tabs, transport controller, xterm renderer, and input rules. A transport lease shares one controller and one connection per terminal bridge across terminal panels. The last lease closes the connection. The task and Workspace Session views supply their owner and requested start directory.

Create, run action, list, close, and path setup use host commands. Input, resize, attach, detach, ACK, output, lifecycle, and title use terminal frames. Electron and web share the host PTY adapter and use separate transports.

## Discover terminals

The frontend uses an owner-scoped TanStack Query read to discover host terminals. Opening an empty panel creates a terminal only after discovery succeeds with an empty list. New terminal creation stays disabled while discovery runs or fails.

An open request made during discovery waits for that result and creates at most one terminal. Discovery failure, existing terminals, closing the panel, or switching owners cancels the request. Later refreshes do not create terminals without a new open request. The current scope shows loading or empty feedback while other scopes keep their viewports mounted.

Each terminal summary has `startedBy`. The value is `user` for a shell or an action that the user starts, and `host` for a terminal that OpenDucktor starts without a user request, such as a worktree-creation action. Until the user opens or closes the panel for an owner, the panel opens when the owner has a terminal that the user started. A `host` terminal stays in the tab list and does not open the panel. When the user opens the panel, the tab shows the retained output.

Discovery failure appears in the panel with `Retry terminal discovery`. Retry refetches the owner query. A failed refresh keeps existing tabs and their mounted viewports. Discovery does not poll or retry automatically. The live terminal transport remains separate from the list query.

## Start a terminal

`workingDir` is required. For a task or Workspace Session, the host reads the current target and checks that the requested directory matches it. The host starts in the saved target, checks that it is an accessible directory, and saves the canonical path as `initialWorkingDir`. For a terminal with no owner, the host starts in the requested directory. Later `cd` commands do not change `initialWorkingDir`.

The host resolves one user environment during startup. On Unix, it uses a login-style `argv0` and interactive login command flags to run the account shell without a PTY. It uses `-ilc` for common shells and `-ic` for csh and tcsh because those shells reject `-ilc`. Runtime starts, tool discovery, Git, and terminals read the current result when they start a child process. A forced runtime check from Diagnostics runs the probe again. See [CLI tool discovery](cli-tool-discovery.md#host-startup). Windows keeps its normalized inherited environment. A failed POSIX probe produces a typed startup diagnostic instead of silently using the GUI `PATH`, and new runtime starts fail before they create a child process.

The host selects the terminal shell, arguments, and clean child environment. The renderer cannot choose an executable, arguments, or environment variables. On Unix, use the login shell from the user account. If it is not available, use the `SHELL` environment variable. Run the shell with `-l` on the PTY, `TERM=xterm-256color`, and `COLORTERM=truecolor`. Shell startup lines that test for a real tty can change the terminal environment after launch, so their result can differ from the probe result.

A terminal can have no owner, a task owner with `repoPath` and `taskId`, or a Workspace Session owner with `workspaceId` and `sessionId`. The host uses this context for lists, limits, and cleanup. It does not restrict file access inside the shell.

For a Workspace Session terminal, the host reads the active session record before launch. It checks the saved repository root or registered worktree and starts the shell in that saved directory. The request must name the same repository and canonical working directory. A missing, archived, or removed session target fails before launch.

For a task terminal, the host requires a task ID that names one directory. It reads the current task worktree and checks that Git still registers it under the requested repository. It rejects a missing worktree or a requested directory outside that worktree. The host starts the shell in the resolved worktree directory.

The first title is the canonical start directory. The host then reads bounded OSC 0 and OSC 2 title codes without changing PTY output. It cleans and stores the latest title, then sends it in snapshots and title events.

## Run a command terminal

A command terminal is one terminal session with two phases under one terminal ID, one byte stream, and one headless screen. The terminal module exposes it through `TerminalCommandService` in `terminal-command.ts`. The terminal module does not read repository settings and does not know about actions.

`startCommand` resolves the owner target as `terminal_create` does. `startCommandInPreparedTarget` starts in a target that the caller already validated, because a new chat has no saved record yet. Each request has a label, one or more command lines, and a `startedBy` value.

1. The command phase runs all command lines in one process of the account shell. The terminal shows the lines before the phase starts.
2. When the command process exits with any code or signal, the host records the command result and the last 20 screen lines.
3. The host then starts the normal shell launch, with shell integration, at the current grid. The user continues in this shell.

When the terminal closes or its process fails before the command ends, the result is `closed` or `failed`. The `failed` result has the process error. Both results have the last 20 lines of parsed output.

The label stays for the full terminal life. OSC titles do not replace it. During the command phase, the activity command is the command lines, workspace activity checks report the terminal as active, and an unconfirmed close returns `confirmation_required`. The command phase does not use the PTY rule that reports a non-zero exit before output as `spawn_failed`. The terminal `exit` reports only the shell-phase exit. Ctrl+C stops the command, and the user continues in the shell.

### Shell syntax

The launch environment port has two methods: `shell()` returns how to start the interactive login shell, and `command(lines)` returns how to run the lines and how to start the shell after them, from one read of the login shell. Only the infrastructure adapter knows the shell and its syntax.

The command launch uses the probe flags: `-ilc`, or `-ic` for csh and tcsh. The adapter builds the script in the syntax of the shell: POSIX (sh, bash, zsh, ksh, mksh, dash, and ash), csh and tcsh, or fish. Another login shell fails with `unsupported_shell`, and no process starts.

The script keeps each line unchanged and saves its status after it, so an inline comment or a trailing `;` keeps its shell meaning, and `cd`, `export`, or `set` continues to the next line. The script stops after the first line that ends with a non-zero status and exits with that status. csh applies `exit` only at the end of a `-c` script, so its script skips the later lines with nested `if` blocks. The fish script uses the same nested blocks. A line that continues on the next line with `\` is not supported.

On Windows, ComSpec must be `cmd.exe`, or the command fails with `unsupported_shell`. The adapter writes the lines to a batch file and adds `if %errorlevel% neq 0 exit /b %errorlevel%` after each line. The PTY adapter writes the file to a private temporary directory, runs `cmd.exe /d /s /c ""<path>""`, and removes the directory when the process ends. Batch syntax applies to the lines, so a `for` loop variable needs `%%`.

## Run an action

An action is a repository command from `RepoConfig.actions`. `terminal_run_action` takes the owner context, the requested directory, and an action ID. The repository action service in `application/actions` reads the saved action and starts a command terminal with the action name as the label and `startedBy: "user"`. Later changes to the action do not change the terminal.

Each non-blank line of the action is one command line. The service skips lines that start with `#`, because an interactive zsh runs `#` as a command.

The service returns typed errors. The `terminal_run_action` handler in `repo-action-command-handlers.ts` maps them to terminal failures:

| Error | Terminal failure code |
| --- | --- |
| `RepoActionNotFoundError` | `action_not_found` |
| `RepoActionHasNoCommandError` | `invalid_input` |

### Worktree-creation actions

The host worktree action runner starts the worktree-creation actions with `startCommandInPreparedTarget`. It runs them in list order after the copied files. Each terminal continues as a normal shell after its command, so the user can work in it. All worktree-creation actions use `startedBy: "host"`, so the panel stays closed until the user opens it.

The runner waits up to 5 minutes for each waiting action. Each failure has its own tagged error with the reason and the last output lines:

| Failure | Error |
| --- | --- |
| Non-zero exit or signal | `WorktreeActionExitError` |
| Time limit | `WorktreeActionTimeoutError` |
| Terminal closed first | `WorktreeActionTerminalClosedError` |
| Terminal process failed | `WorktreeActionTerminalFailedError` |
| Terminal did not start | `WorktreeActionStartError` |

The task start, chat create, and chat restore callers create the run for the new worktree and branch before the setup starts. The run records each terminal in the same step that starts it. Each rollback, also after an interruption, calls `stopTerminals` before it removes the new worktree. A terminal that already exited counts as stopped.

When a terminal cannot stop, the rollback keeps the worktree and branch and fails with `WorktreeKeptForRunningActionsError`. Its message tells the user to close the terminal or restart OpenDucktor, then remove the worktree and the branch. Task and chat rollbacks show the same message.

A task rollback runs each Git step also after an earlier step fails. When a step fails, the rollback fails with `TaskWorktreeRollbackError`, which lists each failed step. The task start adds the rollback message to the start failure and keeps both errors in the cause.

## Attach and replay

The host adds an output consumer before it sends the attachment snapshot. The snapshot has lifecycle, title, first retained byte sequence, and snapshot end sequence. The host then sends retained output followed by live output. Output byte sequences increase monotonically. Exit comes after the final output sequence.

An exited terminal keeps its output for reading. After the exit frame, the renderer disables xterm input and sends no more input to the host. The status line shows the exit code. A clean exit, code 0 without a signal, uses a neutral style. Another exit uses the warning style.

The renderer tracks submitted bytes separately from parsed bytes. It submits contiguous output directly to xterm's ordered write queue. It does not wait for one chunk's callback before it submits the next chunk. After xterm parses a group of chunks, the renderer sends one ACK for that group's last byte sequence. On another attach, it sends the last parsed sequence so the host sends only missing output.

The renderer uses a write barrier only for screen restoration. It waits for submitted writes, resets the screen at the host grid, parses the restore payload, restores unfinished parser state, and then admits live output. A restore replaces earlier queued output from another restore generation. Output with a byte gap fails visibly. Emulator disposal stops later writes, ACKs, and restore callbacks.

The host mirrors all terminal output in a headless xterm screen with up to 2,000 scrollback rows. If the host dropped the requested bytes, it sends `screen_restore` with the current screen, retained scrollback, grid, and unfinished control state. The host trims old scrollback if the snapshot would exceed the terminal frame limit. The renderer resets xterm, applies that snapshot, and then applies later output. Output older than the retained scrollback is unavailable. OSC 8 link targets on retained rows above the viewport are not restored. Their text remains visible. During first attach, keep xterm hidden until it reaches the snapshot boundary. The restore reads xterm's current cursor, saved cursor, colors, character sets, tab stops, and scroll region. It uses one version-pinned internal xterm adapter for fields that the public serializer omits. The host drops the body of an unfinished long OSC or DCS string but keeps its parser state, so later bytes cannot appear as screen text.

Replay, unacknowledged output, and screen parsing have byte limits. A server frame can hold up to 8 MiB. A browser input frame has a 64 KiB limit. `node-pty` can pause and resume in both apps. If a screen cannot fit in one protocol frame, attach fails with an error instead of showing a wrong screen.

When a chunk exceeds a consumer's remaining byte limit, the host retains it and later chunks. The host sends them in byte order after an ACK, even after process exit.

The host runs pause and resume in order. An ACK or detach can request resume while pause runs. The host resumes after pause finishes if output pressure has cleared.

The frontend reconnects the frame transport and attaches mounted terminals again. The web transport waits for socket drain before it attaches another terminal after backpressure. It keeps messages in order for each terminal while other terminals can send input and ACK. A failed socket send fails the attachment. A transport loss removes attachments, not the PTY. If the host instance changes, old tabs become lost. A stale attach gets `terminal_forgotten`. Do not recreate a lost terminal.

## Close and clean up

Before an unconfirmed close, the host checks for child processes. With no child, it closes at once. With a child, it returns `confirmation_required`. A confirmed close stops the process tree and removes the session.

The producer resumes paused output before it stops the process tree. The PTY producer waits for output to close before it reports exit.

If process-tree termination fails while the PTY remains live, the adapter restores the host's current output pause request. An ACK or detach during close can clear that request.

The UI hides a tab while close is pending. It restores the tab when confirmation is needed or close fails.

Task close, delete, reset, and merged-worktree cleanup take a terminal cleanup lease. They stop task terminals before worktrees, branches, or task records. A terminal failure stops later cleanup. The lease blocks a new task terminal during cleanup. It does not block terminals owned by other sessions or the global scope.

Workspace Session archive checks for an active runtime turn first and asks for Stop consent when needed. It stops an active turn, takes a lease for that workspace and session pair, waits for pending starts, and stops only that session's terminals before worktree removal. A terminal stop failure leaves the terminal owned by the host and prevents worktree removal. New terminals for that session fail during archive.

Host shutdown stops admission, stops all PTYs and process trees, then continues host cleanup. An exited session can stay in memory for bounded replay until time or count limits remove it.

Do not persist a PTY handle, PID, route, terminal ID, live state, or transcript. Terminal persistence needs a separate decision about privacy, retention, recovery, and access.

## Keyboard, clipboard, and images

The frontend gets the platform from the host and applies terminal shortcuts. It sends normal input as ordered UTF-8 chunks within the input limit.

Image paste sends the terminal's native paste control so a compatible TUI can read the OS clipboard. Image drag and drop stages each image, asks the host for shell-safe paths, and pastes those paths into xterm. It does not send image bytes through the terminal protocol.

Drag and drop accepts at most eight images, 20 MiB each, and 40 MiB total. An interaction error does not replace the terminal screen. xterm or WebGL startup failure blocks that emulator and appears in its body.

## Viewport

The terminal view uses the shared xterm binding. The binding measures the visible container and calls `Terminal.resize` only when the grid changes. It rejects a collapsed container or the fit add-on's minimum 2-by-1 grid. It does not clear the renderer before each resize. Resize scheduling coalesces changes and permits at most one reflow per 100 ms during a continuous drag. Interactive input flushes the pending fit and host resize first. Theme changes update colors without a grid resize.

## Limits and security

The host applies the same terminal limits to shells and command terminals per task, per Workspace Session, and per host. Pending terminals count through admission until activation. A limit error shows the used capacity and limit and tells the user to close a terminal. A command that exceeds the limit does not run. The host also limits input bytes, grid size, replay bytes, unacknowledged output, and retained exited sessions. Each operation uses an opaque terminal ID. Workspace activity checks include live Workspace Session terminals in the matching repository.

A browser WebSocket upgrade needs the HttpOnly app session, an allowed frontend origin, and the exact protocol name. Invalid direction, frame, or protocol version fails.

Electron and web keep `node-pty` as a production dependency. Electron unpacks native files from ASAR through Electron Builder. The web package runs with Node.js 24.14 or later and installs the native dependency with the package.
