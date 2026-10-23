import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  TERMINAL_PROTOCOL_VERSION,
  encodeTerminalProtocolFrame,
  decodeTerminalProtocolFrame,
  type HostRuntimeSnapshot,
  type AutopilotState,
  type RemoteHostDescriptor,
  type RemoteNegotiationResult,
} from "@openducktor/contracts";
import type { RemoteTransport, RemoteHttpResponse } from "@openducktor/host-client/remote";

// The portable transport runs on Bun, so its abort signals use Bun's native pair.
const nativeAbortController = AbortController;
const nativeAbortSignal = AbortSignal;
GlobalRegistrator.register({ url: "https://host.test" });
globalThis.AbortController = nativeAbortController;
globalThis.AbortSignal = nativeAbortSignal;
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const { act, render, waitFor } = await import("@testing-library/react");
const { useContext } = await import("react");
const { Toaster } = await import("../../frontend/src/components/ui/sonner");
const { RemoteConnectionBoundary } =
  await import("../../frontend/src/components/layout/remote-connection-boundary");
const { createClientQueryClient } =
  await import("@openducktor/frontend-core/connection/client-query-client");
const { createTestClientConnection } =
  await import("@openducktor/frontend-core/test-support/test-client-connection");
const { ClientConnectionProvider } =
  await import("@openducktor/frontend-core/connection/client-connection-react");
const { configureShellBridge, createUnavailableShellBridge } =
  await import("@openducktor/frontend/lib/shell-bridge");
const { HostRuntimeStatusProvider } =
  await import("../../frontend/src/state/providers/host-runtime-status-provider");
const { AutopilotProvider } = await import("../../frontend/src/state/providers/autopilot-provider");
const { WorkspaceStateContext } = await import("../../frontend/src/state/app-state-contexts");
const { HostRuntimeStatusContext, AgentOperationsContext } =
  await import("@openducktor/frontend-core/sessions/session-contexts");
const { NotificationContext } =
  await import("../../frontend/src/state/notifications/notification-context");
const fixtures = await import("../../frontend/src/test-utils/shared-test-fixtures");
const { createAgentOperationsFixture } =
  await import("@openducktor/frontend-core/test-support/agent-operations-fixture");
const { createTerminalTransportController } =
  await import("../../frontend/src/features/terminals/terminal-transport-controller");
const { createRemoteShellBridge } = await import("@openducktor/frontend/lib/remote/shell-bridge");
const workspace = fixtures.createWorkspaceRecordFixture({
  workspaceId: "alpha",
  repoPath: "/repo",
});
const snapshot: HostRuntimeSnapshot = {
  hostInstanceId: "host-a",
  runtimes: [],
  mcpBridge: fixtures.createHostMcpBridgeStatusFixture(),
};
const held: AutopilotState = {
  outcomes: [
    {
      outcomeId: "recovered",
      workspaceId: "alpha",
      repoPath: "/repo",
      task: { id: "task", title: "Task" },
      eventId: "taskProgressedToAiReview",
      actionId: "startQa",
      occurredAt: "2026-10-10T00:00:00.000Z",
      kind: "skipped",
      reason: "The task moved on.",
    },
  ],
  failure: null,
};
const host: RemoteHostDescriptor = {
  shell: "web",
  appVersion: "test-host",
  hostInstanceId: "host-a",
  accessPolicy: "network_reach",
  protocols: [
    { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
  ],
};
const json = (
  value:
    | RemoteHostDescriptor
    | RemoteNegotiationResult
    | HostRuntimeSnapshot
    | AutopilotState
    | { error: string; message: string }
    | null,
  status = 200,
): RemoteHttpResponse => ({
  status,
  headers: {},
  body: (async function* () {
    if (status !== 204) yield new TextEncoder().encode(JSON.stringify(value));
  })(),
});
const readReply = async (
  read: Promise<HostRuntimeSnapshot | AutopilotState>,
): Promise<RemoteHttpResponse> => {
  try {
    return json(await read);
  } catch {
    return json({ error: "host_command_failed", message: "Required recovery read failed." }, 500);
  }
};
function RuntimeState() {
  const state = useContext(HostRuntimeStatusContext);
  return <output data-testid="runtime-current">{String(state?.isCurrent ?? false)}</output>;
}

try {
  for (const result of [
    "runtime-first",
    "autopilot-first",
    "runtime-fails",
    "autopilot-fails",
  ] as const) {
    const heldResult: AutopilotState = {
      ...held,
      outcomes: held.outcomes.map((outcome) => ({
        ...outcome,
        outcomeId: `recovered-${result}`,
        ...(outcome.kind === "skipped" && { reason: `Recovered ${result}` }),
      })),
    };
    let recovering = false;
    let runtimeReads = 0;
    let autopilotReads = 0;
    let sockets = 0;
    let receive!: (frame: Uint8Array) => void;
    const runtimeStarted = Promise.withResolvers<void>();
    const autopilotStarted = Promise.withResolvers<void>();
    const runtimeGate = Promise.withResolvers<HostRuntimeSnapshot>();
    const autopilotGate = Promise.withResolvers<AutopilotState>();
    const socketStarted = Promise.withResolvers<void>();
    const socketGate = Promise.withResolvers<void>();
    const attached = Promise.withResolvers<void>();
    const transport: RemoteTransport = {
      async request(method, url, _headers, signal) {
        if (method === "DELETE") return json(null, 204);
        if (url.endsWith("/connections"))
          return json({
            status: "accepted",
            host,
            connectionId: crypto.randomUUID(),
            protocolVersion: REMOTE_PROTOCOL_VERSION,
            missingOptionalCapabilities: [],
          });
        if (url.endsWith("/events"))
          return {
            status: 200,
            headers: {},
            body: (async function* () {
              yield new TextEncoder().encode(
                `event: replay-complete\ndata: ${JSON.stringify({ hostChanged: false, gaps: recovering ? ["message"] : [] })}\n\nevent: notification-frame\ndata: ${JSON.stringify({ type: "attached", cursor: { epoch: crypto.randomUUID(), sequence: 0 }, reason: "new", health: [] })}\n\n`,
              );
              await new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
                if (signal.aborted) resolve();
              });
            })(),
          };
        if (url.endsWith("/invoke/runtime_status")) {
          runtimeReads += 1;
          if (!recovering) return json(snapshot);
          runtimeStarted.resolve();
          return readReply(runtimeGate.promise);
        }
        if (url.endsWith("/invoke/autopilot_state_read")) {
          autopilotReads += 1;
          if (!recovering) return json({ outcomes: [], failure: null });
          autopilotStarted.resolve();
          return readReply(autopilotGate.promise);
        }
        if (url.endsWith("/remote")) return json(host);
        throw new Error(`Unexpected request: ${method} ${url}`);
      },
      async openTerminal(_url, _headers, _signal, onFrame) {
        sockets += 1;
        receive = onFrame;
        if (sockets === 2) {
          socketStarted.resolve();
          await socketGate.promise;
        }
        return {
          send: async (frame) => {
            if (sockets === 2 && decodeTerminalProtocolFrame(frame).message.type === "attach")
              attached.resolve();
          },
          close: () => {},
        };
      },
    };
    const queryClient = createClientQueryClient();
    const bridge = createRemoteShellBridge({
      endpoint: "https://host.test/remote",
      version: "test-browser",
      transport,
      notifications: createUnavailableShellBridge().notifications,
      queryClient,
    });
    const clientConnection = createTestClientConnection({ host: bridge, queryClient });
    configureShellBridge(bridge);
    const connection = bridge.remoteConnection!;
    const controller = createTerminalTransportController(bridge.terminals, () => {});
    let view: ReturnType<typeof render> | undefined;
    try {
      await waitFor(() => assert.equal(connection.readState().status, "connected"));
      await act(async () => {
        view = render(
          <ClientConnectionProvider connection={clientConnection}>
            <WorkspaceStateContext
              value={fixtures.createWorkspaceStateFixture({
                activeWorkspace: workspace,
                workspaces: [workspace],
              })}
            >
              <AgentOperationsContext value={createAgentOperationsFixture()}>
                <NotificationContext
                  value={{
                    deliveryFailure: null,
                    getCapability: async () => ({
                      platform: "browser",
                      supported: false,
                      permission: "not_applicable",
                      canGuaranteeSilent: false,
                      canOpenSystemSettings: false,
                    }),
                    requestPermission: async () => {
                      throw new Error("Unexpected permission request.");
                    },
                    openSystemSettings: async () => {},
                    previewCue: async () => {},
                    testInApp: async () => {},
                    testOs: async () => ({ status: "shown" }),
                    registerNavigator: () => () => {},
                    sessionStartNotifications: {
                      publishSessionStarted: () => {},
                      publishSessionError: async () => true,
                      markInAppFeedbackHandled: () => {},
                      reportFailure: () => {},
                    },
                  }}
                >
                  <HostRuntimeStatusProvider>
                    <AutopilotProvider>
                      <RemoteConnectionBoundary connection={connection}>
                        <RuntimeState />
                      </RemoteConnectionBoundary>
                      <Toaster />
                    </AutopilotProvider>
                  </HostRuntimeStatusProvider>
                </NotificationContext>
              </AgentOperationsContext>
            </WorkspaceStateContext>
          </ClientConnectionProvider>,
        );
      });
      await waitFor(() => {
        assert.equal(view!.getByTestId("runtime-current").textContent, "true");
        assert.equal(autopilotReads, 1);
      });
      if (result === "runtime-first") {
        const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
        const generation = connection.readState().generation;
        try {
          for (const value of [true, false, true, false]) {
            await act(async () => {
              Object.defineProperty(document, "hidden", { configurable: true, value });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            assert.equal(
              view!.queryByRole("dialog"),
              null,
              "Switching tabs must not show a connection dialog.",
            );
            assert.equal(connection.readState().status, "connected");
            assert.equal(connection.readState().generation, generation);
            assert.equal(view!.getByTestId("runtime-current").textContent, "true");
          }
        } finally {
          if (hidden) Object.defineProperty(document, "hidden", hidden);
          else Reflect.deleteProperty(document, "hidden");
        }
      }
      controller.subscribe("terminal-1", () => {});
      await controller.connect();
      await controller.acknowledge("terminal-1", 2);
      recovering = true;
      let retry!: Promise<void>;
      await act(async () => {
        retry = connection.retry();
      });
      const outcome = retry.then(
        () => null,
        (cause: unknown) => cause,
      );
      await socketStarted.promise;
      assert.equal(connection.readState().status, "synchronizing");
      assert.equal(runtimeReads, 1);
      assert.equal(autopilotReads, 1);
      socketGate.resolve();
      await attached.promise;
      receive(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "snapshot",
            terminalId: "terminal-1",
            snapshotSequenceEnd: 4,
            earliestRetainedSequence: 0,
            lifecycle: "running",
            title: "Terminal",
            complete: true,
          },
          payload: new Uint8Array(),
        }),
      );
      receive(
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "output",
            terminalId: "terminal-1",
            sequenceStart: 2,
            sequenceEnd: 4,
            replay: true,
          },
          payload: new Uint8Array([3, 4]),
        }),
      );
      await Bun.sleep(0);
      assert.equal(runtimeReads, 1);
      assert.equal(autopilotReads, 1);
      assert.equal(connection.readState().status, "synchronizing");
      await act(async () => {
        await controller.acknowledge("terminal-1", 4);
      });
      await Promise.all([runtimeStarted.promise, autopilotStarted.promise]);
      assert.equal(view!.getByTestId("runtime-current").textContent, "false");
      if (result === "runtime-first" || result === "autopilot-fails") {
        await act(async () => {
          runtimeGate.resolve(snapshot);
        });
        await waitFor(() => assert.equal(view!.getByTestId("runtime-current").textContent, "true"));
        assert.equal(connection.readState().status, "synchronizing");
        assert.equal(view!.queryByText(`Recovered ${result}`), null);
        if (result === "autopilot-fails") autopilotGate.reject(new Error("Autopilot failed."));
        else autopilotGate.resolve(heldResult);
      } else {
        await act(async () => {
          autopilotGate.resolve(heldResult);
        });
        await waitFor(() => assert.ok(view!.getByText(`Recovered ${result}`)));
        assert.equal(view!.getByTestId("runtime-current").textContent, "false");
        assert.equal(connection.readState().status, "synchronizing");
        if (result === "runtime-fails") runtimeGate.reject(new Error("Runtime failed."));
        else runtimeGate.resolve(snapshot);
      }
      let cause: unknown;
      await act(async () => {
        cause = await outcome;
      });
      if (result.endsWith("fails")) {
        assert.ok(cause);
        assert.equal(connection.readState().status, "failed");
        assert.equal(connection.readState().failure?.code, "synchronization_failed");
      } else {
        assert.equal(cause, null);
        assert.equal(connection.readState().status, "connected");
        assert.equal(view!.getByTestId("runtime-current").textContent, "true");
        await waitFor(() => assert.ok(view!.getByText(`Recovered ${result}`)));
      }
    } finally {
      runtimeGate.resolve(snapshot);
      autopilotGate.resolve(held);
      socketGate.resolve();
      await controller.dispose();
      await act(async () => {
        view?.unmount();
        await bridge.dispose?.();
      });
      bridge.notifications.dispose();
      await clientConnection.dispose();
      configureShellBridge(createUnavailableShellBridge());
    }
  }
} finally {
  await GlobalRegistrator.unregister();
}
