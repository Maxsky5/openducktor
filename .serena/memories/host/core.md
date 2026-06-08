# Host Core

- Location: `packages/host`; Effect-native TypeScript host for Electron/web transports, command routing, application use cases, and infrastructure adapters.
- Composition entrypoints include `packages/host/src/composition/node/create-node-host-command-router.ts`, `node-host-default-ports.ts`, and lifecycle helpers under `packages/host/src/composition`.
- Keep fallible/I/O-producing host ports and application services as `Effect.Effect` internally. Promise interop is for Electron IPC, browser HTTP/SSE, shell bridge adapters, and external package APIs.
- Ports define host/application boundaries; adapters wrap infrastructure such as Beads, Git CLI, runtime registry, Codex/OpenCode runtimes, MCP bridge, filesystem, settings, system commands, and tool discovery.
- Expected failures should be typed/actionable host errors and travel through the Effect error channel.
- Runtime routing must be fail-fast. Do not fall back from session/build runtime to repo default runtime for session history, todos, diff, or file status.
- Blocking work must stay off the UI thread. Avoid re-running expensive repo initialization when cached readiness is known.
- For host refactors, verify lifecycle/routing/typed-error behavior with focused tests before relying on broader workspace checks.