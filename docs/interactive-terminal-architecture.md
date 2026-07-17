# Interactive terminal architecture

Interactive terminals are transient, host-owned resources. The renderer owns xterm instances and
panel preferences; it never owns PTY processes or stores transcripts in the task database.

## Boundaries

- `packages/contracts` defines launch metadata, summaries, typed failures, and the versioned binary
  protocol. A frame is a four-byte big-endian JSON-header length, the JSON header, then raw bytes.
- `packages/host` owns terminal identity, launch policy, the in-memory registry, replay, sequencing,
  flow control, cleanup, transient OSC title metadata, and the runtime-neutral `TerminalPtyPort`.
- Electron composes the Node adapter backed by `node-pty`. The browser runner composes the Bun
  adapter backed by `Bun.spawn({ terminal })`. Composition is explicit; there is no adapter fallback.
- Electron exposes a narrow IPC channel through preload. The browser runner exposes one
  authenticated, origin-checked, multiplexed WebSocket using the
  `openducktor-terminal.v1` subprotocol.
- Agent Studio uses `@xterm/xterm` with the fit addon in a task-aware bottom panel. Task context is
  discovery metadata, not a filesystem sandbox.

`workingDir` is mandatory creation input. The host canonicalizes it, verifies it is a directory,
and records it as immutable `initialWorkingDir`. It is deliberately not presented as the shell's
current directory. Shell selection and the scrubbed process environment are host policy; the
renderer cannot supply an executable, arguments, or environment variables.

The host observes bounded OSC 0/2 title sequences without altering PTY bytes, keeps the latest
sanitized title in the transient terminal summary, and includes it in attachment snapshots and
live title events. The renderer displays that metadata and does not derive a competing title from
replayed xterm output, so renderer reload starts with the current title instead of visibly replaying
historical title changes.

## Attachment and flow control

The service subscribes an attachment before publishing its snapshot. Output receives monotonically
increasing byte sequence ranges, bounded replay is emitted before live output, and an unavailable
range produces an explicit replay-gap event. Exit is published only after prior output is ordered.

An ACK means xterm finished consuming the output callback. Pending output and replay are byte
bounded. The Node adapter pauses and resumes PTY output under pressure. A runtime without safe pause
support terminates with a typed overflow rather than accumulating unbounded output.

Disconnect detaches the renderer but does not terminate or recreate the PTY. A host restart changes
the host instance ID; remembered terminal IDs from the previous instance are shown as lost and are
never silently replaced.

## Lifecycle and cleanup

Closing a live terminal requires explicit terminate-and-close confirmation. Close failures keep the
record visible and retryable. Task close, delete, and reset terminate associated terminals before
dev-server, worktree, branch, or task-store cleanup; failure aborts the remaining cleanup. Host
shutdown stops accepting terminal work, terminates all PTYs/process trees, then continues normal
host teardown.

No PTY handle, PID, route, live interaction state, or transcript is persisted in SQLite. Adding
transcript persistence requires a separate privacy, retention, and access-control decision.

## Resource and security limits

The host bounds terminals per task and per host, input size, grid dimensions, replay bytes, and
unacknowledged output. Transports additionally bound frames and outbound queues. Every operation is
addressed by an opaque terminal ID. Browser traffic requires the established HttpOnly app session,
an allowed loopback frontend origin, and the exact terminal protocol version.

Electron packaging keeps `node-pty` as a production dependency, unpacks its native files from ASAR,
and relies on Electron Builder's declarative dependency and ASAR configuration. The terminal
feature adds no dependency-specific packaging script.
