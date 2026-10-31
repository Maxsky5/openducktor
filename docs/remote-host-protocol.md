# Remote host protocol

## Clients and hosts

A host runs workspaces, agents, sessions, and terminals. A client shows the work of its selected host.

Electron and the normal web runner select their own local host by default. The standalone web client starts at a host picker and does not start a host.

Select the host icon at the bottom of the workspace rail, left of Settings, to open Host connection. The dialog shows the selected host above the New host address field. Desktop app host and Web runner host name the host supplied by that shell. For a selected local host, the dialog shows whether remote control is on or off. Remote control settings opens that Settings section. When remote control is on, the dialog also shows the sharing address, live client count, Copy address, Show QR code, and Disable remote control. These controls use the same state, change operation, and address view as Remote control settings. A remote host shows its full address once. Paste the address from the other host's Remote control settings, then select Switch host. Use desktop host or Use web runner appears only when that shell has a local host and it is not selected. Host changes sit in the dialog footer, with Cancel on the left. Disconnect returns a remote client to the connection screen. Cancel keeps the selected host. During onboarding, the host icon sits with the header controls.

Selecting the current host does not reload the client. Switching to a different host or disconnecting reloads the window and clears the old host's reads, events, and work state. The client stops local delivery at once and waits for pending admission cleanup before it reloads. Cleanup uses the existing setup and release deadlines. Host work keeps running. Remote drafts stay in the memory of their client connection and are lost on reload or host change. Copy any unsent draft first. Existing local drafts stay on this device.

The standalone client starts at the connection page on its first visit. Use `bun run browser:client` to test this mode. It reads no host settings or work until the connection is ready. The connection page has Light, Dark, and System theme choices and saves its theme in this browser.

The client saves its host choice in this browser's local storage and restores it after reload or a later visit. The address bar contains no selected host. Disconnect saves the connection page as the next startup choice. Remote work routes use the URL hash. Host selection adds no task-store record or schema.

Remote control, app updates, external links, and clipboard functions belong to the local shell even when its client views another host. A standalone client has no local host and does not show Remote control.

See [the web runner guide](web-runner.md#deploy-your-own-copy) for the static client build.

## Access and host ownership

Remote access is an extra entry point to the running Electron or web host.
Both shells use `@openducktor/remote-host` and the same command router, event journal, task and notification streams, terminal service, and resource readers as their local frontend.
Electron keeps its existing renderer and preload IPC.
Closing the Electron window still stops its host and all remote connections.

Remote access is disabled by default.
Network reach grants access to all hosted workspaces and normal host work, without sign-in, passwords, pairing, device approval, or per-device revocation.
The operator must restrict reach with a protected network, such as Tailscale, or a protected HTTPS proxy.
The QR code contains the same work address that the operator can copy.
It contains no credential and creates no trust record.

The shell owns the host, and the network adapter owns its listener and connections.

```mermaid
flowchart TD
    E["Electron IPC frontend"] --> H["Existing host services"]
    L["Private browser frontend"] --> H
    R["Remote native or browser client"] --> N["Shared network adapter"]
    N --> H
    O["Local operator controls"] --> N
```

## Enable and disable

Open Settings, Remote control in the local frontend.
This page lets other devices access the current OpenDucktor instance.
Choose the network that the other device can reach, then select Enable remote control.
The host lists its own network addresses and uses IPv4 when that network has it, or unscoped IPv6 otherwise.
Loopback and scoped link-local addresses do not appear in this list.
The listener uses port `14328` unless the operator enters another port in Advanced.
The default address is the listener origin, such as `http://192.168.1.9:14328`. Users do not add a `/remote` suffix.
Copy the address into a compatible OpenDucktor client, or show its QR code in a separate dialog.
A browser opened at the host address shows its descriptor as JSON. To use the full app, open a standalone web client and paste the host address into its picker.
The On status means the listener started; it does not prove that a phone can reach it.
The local host uses a laptop icon. It uses the running-session color when remote control is on and gains a small dot when external clients connect. The tooltip gives the client count. Each client with a live event, task, or terminal stream counts once. Disconnecting its last stream clears it from the count. Operator status updates use the existing live status subscription.
Advanced contains the port, the local listen address, and the public host address.
When another app uses the port, the page shows `port_in_use` and a "Use another port" action.
That action asks the operating system for a free port, and the host keeps that port from then on.
The local listen address selects which network accepts connections; a wildcard or loopback listen address needs an explicit reachable public host address.
The public host address sets the copied address, QR code, allowed hostname and browser origin, and optional path prefix. It does not configure a proxy.
Invalid fields show a readable error before the listener starts.
An invalid endpoint or a bind failure leaves local host work usable and shows a configuration failure.
Select Disable remote control to stop admission and end every remote attachment.
Disablement also closes pending remote HTTP responses and active transfers on a shared listener.
Accepted commands continue under the host's command lifetime.
Terminal client cleanup detaches observers; it does not close a shared PTY.

Each shell accepts this startup configuration:

```sh
OPENDUCKTOR_REMOTE_HOST=100.64.0.1
OPENDUCKTOR_REMOTE_PORT=14328
OPENDUCKTOR_REMOTE_ENDPOINT=http://100.64.0.1:14328
```

Supply all three values to request enablement.
A partial or invalid configuration shows a remote failure.
Enable and disable take effect immediately.
The host saves the operator's choices in `remoteAccess` of the settings file: the on or off state and the listener of the last enable, with the port that it bound.
A disable keeps that listener, so the next enable uses the same address.
At start, the host turns remote control on again with the saved listener when it was on.
A saved port that another app took shows `port_in_use`. The host does not choose another port by itself, because the clients know the old address.
Startup configuration from environment variables or launcher options replaces the saved listener for that run and is not saved.
No connection IDs or device records enter durable storage.
In the local operator contract, `listenPort: 0` requests a free port from the operating system.
The returned `configuration` names the bound port, and `configuration.publicEndpoint` always contains the resolved connection address.
While remote control is off or failed, `configuration` is the saved listener, which the next enable uses.
The private network-list route is `GET /remote-access/networks`; remote clients cannot use it.

The endpoint must use `http` or `https`, include the work mount path, and contain no credentials, query, fragment, wildcard, loopback hostname, or zero port.
Direct HTTP access needs the mobile platform's cleartext-network permission.
The native app owns that platform setup.
HTTPS clients must validate certificates; they must not downgrade to HTTP or ignore certificate failures.

## Web entry points and proxies

The normal launcher needs no network parameters to open Remote control or Host connection. Enabling Remote control starts a separate work listener while the local frontend stays private. It does not publish the browser UI.

The work listener accepts `https://app.openducktor.dev`, loopback web client origins, packaged Electron's opaque origin, and its own public origin. Add another static web deployment's origin in Advanced, Other web clients. An origin contains the scheme, hostname, and optional port, with no path or trailing slash. This allowlist applies to HTTP and terminal WebSocket requests. Unlisted browser origins get a `403` response. Allowed preflight responses send `access-control-max-age: 600`, so a browser reuses one preflight for up to 10 minutes.

An HTTPS web client must use an HTTPS host endpoint. A native client can use HTTP if its platform permits it. Hosting the client and exposing the host are separate operations.

A non-loopback web `--host` or `--external-url` enables remote browser mode.
Network browser pages and their work endpoints require HTTPS.
The launcher rejects an HTTP browser origin or explicit work endpoint before it starts services.
The launcher prints a separate loopback Local operator URL and serves local configuration there.
The network browser configuration contains the remote work endpoint and no launcher or local app token.
Remote browsers cannot enable, disable, update, install, or stop the shell.
Loopback-only HTTPS and proxy configurations keep local browser mode.

Existing `--host`, `--external-url`, `--backend-port`, and `--base-path` options still define the network URLs.
The remote endpoint uses the browser backend URL without an added path suffix.
Use `--remote-endpoint` for a different complete proxy work endpoint.
Explicit `--host`, `--backend-port`, and `--remote-endpoint` values override `OPENDUCKTOR_REMOTE_HOST`, `OPENDUCKTOR_REMOTE_PORT`, and `OPENDUCKTOR_REMOTE_ENDPOINT` in both browser modes.
These overrides do not enable remote access in an otherwise local run without remote startup values.
When the remote and private bind addresses and ports match, their separate request handlers share the existing private HTTP listener.
Private app-session requests keep their existing protection and URLs.
Explicit remote admission always selects the remote handler, even when private credentials are also present.
Without remote admission, local app or control credentials select the protected private handler; other requests select the remote handler with the configured prefix or its stripped proxy mapping.
Disabling remote access removes remote admissions and attachments while the private listener remains available.
The launcher resolves an OS-assigned backend port before publishing the remote endpoint.

For this command, clients use `https://machine.ts.net/api`:

```sh
npx @openducktor/web --host 127.0.0.1 \
  --external-url https://machine.ts.net --base-path /api \
  --backend-port 14327
```

Forward `/api` and its child routes to the remote listener at `127.0.0.1:14327`.
The proxy can retain the complete configured endpoint prefix or strip it to `/`.
Forward the frontend origin to its frontend port.
Do not forward the private local backend or its `/remote-access` and launcher routes.
Disable SSE buffering, allow streaming responses, and forward terminal WebSocket upgrades and offered subprotocols.
Do not redirect work requests; configure clients with the final endpoint.
Keep the configured browser origin and Host header in the allowlists.
Native HTTP requests can omit Origin; browser headers do not identify a device.

## Compatibility

The current remote protocol is `3`, as `REMOTE_PROTOCOL_VERSION` in `packages/contracts` sets.
The protocol version is independent of app release versions.
Hosts and clients can use different app versions when they share a protocol version and the client receives all required capabilities.
A breaking change to required behavior needs a new remote protocol version.
An additive optional capability keeps the current protocol version.

| Baseline capability | Meaning |
|---|---|
| `host.work.v1` | Host reads and commands for workspaces, tasks, sessions, queues, runtime actions, history, and staging. |
| `host.events.v1` | Host, task, notification, workspace, and runtime updates. |
| `agent.live.v1` | Live session snapshots, ordered changes, context, pending input, and replies. |
| `terminal.v2` | Shared terminal creation, observation, attachment, input, resize, acknowledgements, and output recovery. |
| `work.resources.v1` | Registered task assets and staged attachment previews. |

| Optional capability | Meaning |
|---|---|
| `streams.heartbeat.v1` | The host writes the SSE comment `: heartbeat` on `GET R/events` and on each task stream every 15 seconds. |
| `history.tool_details.v1` | The host reads `toolDetails: "on_demand"` in a session history read and serves `agent_runtime_load_session_tool_part`. See [reply size and compact history](#reply-size-and-compact-history). |

A network path, such as a NAT, a proxy, or the Android emulator, can drop an idle stream without closing it.
The heartbeat keeps the path busy.
A client that receives `streams.heartbeat.v1` treats a stream without bytes for 45 seconds as a lost connection and reconnects.
A client without the capability keeps a quiet stream, because an older host sends no heartbeat.

Discovery returns `shell`, `appVersion`, `hostInstanceId`, `hostId`, `accessPolicy: "network_reach"`, and supported protocol versions with capability names.
`hostInstanceId` identifies the live host run; it is not a durable trust identity.
`hostId` identifies the host across restarts. The host creates it once in its settings file. A client uses it to know a saved host at a new address. It grants no access. Older hosts send no `hostId`.
Negotiation sends this client hello:

```json
{
  "appVersion": "mobile-release",
  "supportedProtocolVersions": [3],
  "requiredCapabilities": ["host.work.v1", "host.events.v1", "agent.live.v1", "terminal.v2", "work.resources.v1"],
  "optionalCapabilities": ["streams.heartbeat.v1", "history.tool_details.v1"]
}
```

Acceptance returns the descriptor, selected protocol, transient `connectionId`, and missing optional capabilities.
A protocol mismatch names both app versions and supported protocols and states which side needs an update.
A missing required capability refuses admission and names that capability.
Missing optional capabilities leave admission usable; their unsupported functions report `function_unavailable`.
Runtime readiness remains a separate host failure.
Clients use host commands for runtime work; a host runtime's loopback route is never their network target.

## Work routes

Let `R` be the complete work endpoint.
Every work request, resource, stream, lease operation, and terminal upgrade must resolve a current negotiated connection.
All HTTP clients send `x-openducktor-connection-id`.
Negotiation does not set a cookie, and cookies cannot select a remote connection.
Connection IDs remain in memory and expire after 60 seconds without requests or active streams.
The host bounds admissions to 128 and task leases to 32 per connection.
The ID records compatibility, not device authorization; any reachable compatible client can negotiate a new one.

| Method and route | Contract |
|---|---|
| `GET R` | Discover the host. |
| `POST R/connections` | Negotiate the client hello. |
| `DELETE R/connections/current` | Release this live admission. |
| `POST R/invoke/{command}` | Use existing host command inputs and results. |
| `GET R/events` | Combined host and notification SSE. |
| `POST R/task-events/subscriptions` | Create an owned lease with `subscriptionId` and captured `replayBoundary`. |
| `GET R/task-events/subscriptions/{id}/stream` | Stream existing task frames. |
| `POST R/task-events/subscriptions/{id}/ack` | Acknowledge `{ "cursor": ... }` after applying state. |
| `DELETE R/task-events/subscriptions/{id}` | Release an owned lease. |
| `GET R/terminal` | Upgrade to terminal protocol 2. |
| `GET R/task-assets/{workspaceId}/{taskId}/{scope}/{assetId}` | Read a registered task asset. |
| `GET R/local-attachment-preview?path={stagedPath}` | Resolve and read a staged attachment. |

Startup progress uses `openducktor://session-startup-progress` on the SSE event name `startup`. Each event carries a cumulative operation snapshot. Its replay gap is separate from task, browser, and runtime events. Clients establish the event subscription before they send a tracked startup command.

Remote protocol `3` also carries initial terminal command outcomes in terminal summaries. Terminal frames keep protocol `2`.

Mutation requests require JSON.
Command validation, workflow transitions, approvals, selected-runtime resolution, session ownership, and resource limits stay in host services.
A lease ID alone cannot access another connection's task stream.
Resource responses retain the host's access restrictions and private no-store headers.
Shell functions `open_external_url` and `system_open_directory_in_tool` are unavailable remotely.
Remote `system_list_open_in_tools` calls return an empty list so clients do not offer host applications that they cannot launch.
Launcher shutdown, installation, and updater controls have no remote routes.

Terminal upgrades offer `openducktor-terminal.v2` and `openducktor-connection.<connectionId>`.
The server verifies the connection tag, then selects `openducktor-terminal.v2`.
An explicit connection header must agree with the tag.
Browser WebSockets cannot set request headers, so each tab sends its connection ID in the tag.
Native upgrades can omit Origin or use the configured public endpoint origin.
Use the same terminal ID and last consumed sequence to attach to a surviving PTY.
Keep terminal protocol backpressure, replay, screen restore, overflow, and lost-handle meanings unchanged.

| HTTP status | Meaning |
|---|---|
| `400` | Malformed protocol or request. |
| `409` | Missing capability, expired admission, or unavailable function. |
| `426` | No shared protocol version. |
| `503` | Disabled or unavailable admission. |

A structured `RemoteFailure` contains `code`, `message`, and `nextAction`, with compatibility metadata when needed.
Host command failures preserve `HostInvokeFailure`, including accepted and partial outcomes.
If an Electron command fails and its error log also fails, the remote response reports the logging failure and keeps the command outcome data.
An unreachable endpoint cannot explain whether the host stopped, remote access was disabled, or the network failed.
Report only the evidence the platform supplies.

## Reply size and compact history

The remote client reads a command reply of up to 32 MiB and an event of up to 4 MiB. A larger reply to a read fails only that read with `RemoteReplyTooLargeError`, which has the code `consumer_overflow`. A larger reply to a mutation fails with `outcome_unknown`, because the host ran the mutation. The connection stays connected, and the client sends neither command again. Reconnect recovery treats this error as an error of its read, not as a lost connection, so the read's view shows it. This does not apply to the recovery steps that must finish before the connection is ready, such as the live session attach and the task stream setup. An oversized reply in one of these steps still fails the connection attempt. A larger event ends the event stream, because the client cannot skip an event without a gap.

Session history grows with each tool call, so remote clients ask for compact history. With `toolDetails: "on_demand"`, `agent_runtime_load_session_history` cuts each string longer than 1024 characters in the `input`, `metadata`, `output`, and `resultContent` of a completed or failed tool part to its first 1024 characters. The host sets `detailsOmitted: true` on each part that it cut. Most row summaries read only the first characters, so they do not change. A summary that shows the `message` or `result` field of a JSON output longer than 1024 characters shows the start of the raw output instead. The full output shows when the user opens the row.

The host keeps these parts and fields whole:

- Running and pending tool parts, because live events still update them.
- Tool types `question`, `todo`, and `file_edit`, because their rows read all their data.
- The outputs of `odt_search_tasks`, `odt_create_task`, `odt_update_task`, and `odt_set_task_artifact`, because their rows parse these outputs.
- `error`, `preview`, `title`, file diffs, file content, and computer use data.

When the user opens the details of a cut row, the client reads the full part with `agent_runtime_load_session_tool_part`. Its input is the policy-bound session reference with `partId` and `callId`. The host reads the full history and returns the matching part. A part that is no longer in the history fails with `invalid_input`.

The remote client asks for compact history only from a host with `history.tool_details.v1`. It adds `toolDetails` to each history read when it sends the read on such an admission. An older host does not know the field, so the client reads full history from it. Local history stays complete.

## Portable client and recovery

Remote browser task assets and staged previews use the current client's admission header. The browser bridge returns Blob data with the host's media type. TanStack Query shares each resource read while views use it, and removes inactive resource data with `gcTime: 0`. Each view creates its own Blob URL and revokes it when its source changes or the view closes. Closing the last view also cancels an unfinished resource read. These reads keep the existing asset and staged-file limits and access checks.

Resource query keys include the connection generation. A new admission starts new resource reads. A resource failure stays visible in its view and does not fail the current-work recovery barrier. Electron and the private browser keep their existing resource URLs and IPC or local HTTP delivery.

A client app uses `createRemoteHostConnection` from `@openducktor/frontend-core/recovery/remote-host-connection`.
Supply the endpoint, the client app version, a `RemoteTransport`, and the query client of the same `ClientConnection`.
It wraps `createRemoteHostClient` from `@openducktor/host-client/remote` and owns the recovery barrier below: task stream owners, live attachments, registered platform owners, the notification replay relay, and the refetch of active reads.
Pass the result as the host of `createClientConnection`, with `releaseHost` set to disconnect the remote client. Disposing the connection releases the admission and sends no host command.
Desktop and web clients store remote-host drafts in connection memory, so two hosts never read each other's drafts, even with identical repository paths. They set `saveDraftsOnDispose: false` for this storage, so disposal does not wait for draft attachment uploads.
The mobile app stores the drafts of each saved host on the device, in a separate store for that host. Drafts keep the size limits and the 7-day expiry of desktop local drafts and survive app restart, host switch, and connection loss. The app saves the drafts when it goes to the background and before a host switch. Its connection sets `saveDraftsOnDispose: false`, so a removed host or discarded drafts upload no attachment. Removing a saved host deletes its store. See [the mobile app](../apps/mobile/README.md#host-connections).
Electron and the browser use the same module through `createRemoteShellBridge`.
The portable entry point uses no React, DOM, EventSource, Node API, browser cookie bootstrap, or runtime SDK.
A native adapter can supply streaming HTTP, such as `expo/fetch`, and its platform terminal socket factory.
The native app must supply redirect rejection, normal certificate validation, cancellation, and binary terminal frames.
A standard JavaScript socket factory alone does not prove native redirect rejection.
The mobile app in `apps/mobile` supplies these guarantees through its own native HTTP module and the platform WebSocket. [ADR 0012](adr/0012-build-the-mobile-client-as-an-expo-shell-over-frontend-core.md) records the decision.

Subscribe to state, host events, and notifications before `connect()`.
The connection reports `connected` after compatible admission, host replay completion, notification attachment, and application synchronization.
The synchronizer receives the generation, AbortSignal, current descriptor, previous host instance ID, and host replay gap information.
Restore selected task streams and live or terminal attachments before current-state reads.
Await owned task `ready` promises only after state application has acknowledged the captured replay boundary or its replacement snapshot boundary.
Later live events do not extend that barrier.
The remote host connection uses the task and live-session state owners, the notification replay relay, and the active TanStack Query reads of its own client connection.
Recovery does not refetch reads that set `meta: { skipHostRecovery: true }`, such as resource reads and the remote access state of this device.
After a failed first attempt, the first successful admission also recovers mounted state owners, even when no previous host instance ID exists. Fresh bootstrap reads keep their initial path so they do not wait on their own connection barrier.
Reconnect listeners return the recovery promises that must finish before remote work unlocks.
The runtime status owner returns its baseline recovery because its Query observer does not fetch on its own.
Recovery waits for the latest owned baseline if a host event replaces the read, and a failed baseline fails the connection.
Autopilot returns its held-outcome read and application.
Selected terminal owners join synchronization through `subscribeRecovery` before current-state reads.
They wait for the attachment snapshot and consumption through its output boundary, or an explicit lost-terminal result.
Later output does not extend that boundary, and terminal restoration fails after a 10-second deadline or a protocol failure.

Discovery, negotiation, resource and lease responses, and stream or terminal setup have bounded deadlines.
Host commands use the connection's cancellation signal and have no fixed client deadline.
The host sends the command response when work completes.
The client reports state and event listener errors without stopping connection or event delivery.
Established streams remain event-driven.
With `streams.heartbeat.v1`, a stream that stays silent for three heartbeats is a transport loss.
A work request that the host refuses with `connection_expired` is also a transport loss, because the host no longer knows the admission and ran no work.
Changing browser tabs keeps the live host connection and work state. One page owner pauses a remote connection in the browser's back/forward cache and resumes it when visible. Notification owners stay alive during that pause.

A cached page reloads if the selected host changed or its previous client was released. Local clients release their owners on cache entry and rebuild on history restore. Leaving the page closes the client and its notification owners.
Transport loss cancels old-generation handles and permits active reconnect with exponential backoff capped at 15 seconds, or manual `retry()`.
`setActive(false)` and `disconnect()` cancel attempts.
Permanent endpoint, protocol, capability, TLS, and local network failures require correction and explicit retry.
A synchronization failure retries with the same backoff, and the connection state keeps its failure, so the user can see it.
In synchronization, a recovery read that the host answers with an error shows that error in its view. Only a lost connection fails synchronization.
The browser transport reports `transportCause: "local_network"` when the browser blocks Local Network Access before the host first answers.
Same-host reconnect resumes retained cursors; a replay gap requires the affected current state.
A new host instance replaces stale live state and old handles.

Terminal owners receive connection loss and can reattach to surviving terminals.
After host restart, old terminal IDs report loss; clients must not recreate the terminal or replay its input.
A lost command result or terminal input delivery reports `outcome_unknown`.
Read current host state to establish its outcome when possible.
Never resend a mutation or terminal input automatically.
A command in `HOST_READ_COMMAND_NAMES` only reads host state. After a lost reply or a `connection_expired` refusal, the client waits up to 30 seconds for the reconnect and sends the read again.
A read sent while the client reconnects by itself waits until it connects, after the recovery barrier. A read of the barrier runs at once.
A result that does not match the command schema reports `invalid_protocol` and keeps the connection.
`confirmEventStream()` resolves true when the event stream delivers bytes by its next heartbeat, and false when it stays silent or the host has no `streams.heartbeat.v1`. A client calls it after a device pause, such as a locked screen, and reconnects on false.
