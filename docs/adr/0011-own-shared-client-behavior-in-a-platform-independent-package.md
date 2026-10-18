---
status: accepted
date: 2026-10-18
---

# Own shared client behavior in a platform-independent package

## Context

OpenDucktor has desktop and browser clients, and it will have an Expo and React Native client. The client behavior that all of them need lived in `packages/frontend` next to browser presentation: query modules, the live session projection, history reconciliation, notification policy, connection recovery, and drafts.

Some of that code read browser APIs, showed feedback through `sonner`, or reached the host through module-level singletons: a host client proxy, a shell bridge, and one app query client. Electron and the browser reload the document when the user changes the host, so those singletons were safe there. A React Native app does not reload, and the frontend package also depends on DOM-only libraries. Expo could not reuse the code, and a copy would create a second implementation of session and recovery behavior.

## Decision

Put shared client behavior in `packages/frontend-core` (`@openducktor/frontend-core`).

- The package depends only on `@openducktor/contracts`, `@openducktor/core`, `@openducktor/host-client`, `@openducktor/path-support`, `@tanstack/react-query`, `react`, `zod`, and `zustand`. It imports no `react-dom`, DOM-only UI library, frontend, host, shell, Node, or Bun code. The oxlint rule `architecture/allowed-imports` checks each production import against this list and rejects relative imports that leave the package. Knip reports a declared dependency that no file imports.
- `packages/frontend-core/tsconfig.json` compiles production sources with `lib: ["ES2023", "ES2024.Promise"]` and no ambient types. `src/platform/platform-globals.d.ts` lists the standard globals that the package uses. A client platform must supply each of them.
- A `ClientConnection` (`createClientConnection`) owns the state and lifetime of one host connection: the host client and event streams, one query client, draft stores in device storage, platform ports, and `dispose()`. Query functions read the host of the query client that runs them through `connectionHost`. Disposal saves unsaved drafts, reports a failed save to its caller, and sends no command that stops or changes host work.
- React effects under `ClientConnectionProvider` own the event subscriptions. A platform unmounts that tree before it disposes the connection.
- Platforms supply ports: `ClientFeedback` for transient feedback, `ClientStorage` for device-local state, an `AttachmentStager` for device files, a `RemoteTransport` for remote hosts, and notification delivery adapters.
- `ClientConnectionProvider` and the connection hooks expose the connection to React. The package exports each module path (`"./*"`), so platforms import the module that owns a behavior.
- `packages/frontend` keeps presentation and the browser implementations of the ports. Electron and the browser runner create one connection for the selected host. Their IPC, HTTP, SSE, and WebSocket transports do not change.

## Options we rejected

- Keep the code in `packages/frontend` with lint rules for a client folder. Expo would still depend on the frontend package and its DOM-only dependencies.
- Copy the behavior into a mobile package. Session projection, history merge, and recovery rules would drift between clients.
- Keep module-level singletons and require a reload on each host change. A React Native app cannot reload its runtime to isolate hosts, and two hosts with identical repository paths would share caches and drafts.
- Move the React providers that combine app slices into the package. They hold presentation choices of each app, so each platform composes them.

## Consequences

A mobile client builds a `ClientConnection` with its own ports and uses the same queries, session projection, history, recovery, notification policy, and drafts as desktop and browser.

Two connections in one JavaScript runtime keep separate caches, drafts, subscriptions, and late responses.

`packages/frontend-core/expo-compat/consumer.ts` compiles the public entry points without DOM, Node, or Bun types. Package tests run without DOM globals unless a test file registers them.

A new global in shared code fails the package typecheck until the global is listed in `platform-globals.d.ts`, so each new platform requirement is a visible decision.

## References

- `packages/frontend-core/src/connection/client-connection.ts`
- `packages/frontend-core/src/platform/platform-globals.d.ts`
- `docs/architecture-overview.md`
- `docs/remote-host-protocol.md`
