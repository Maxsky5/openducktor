import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createTaskCardFixture, enableReactActEnvironment } from "./agent-studio-test-utils";

enableReactActEnvironment();

const openStartModalMock = mock(() => {});
const closeStartModalMock = mock(() => {});

mock.module("@/components/features/agents", () => ({
  SessionStartModal: ({ model }: { model: Record<string, unknown> }): ReactElement =>
    createElement("mock-session-start-modal", model),
}));

mock.module("../shared/use-session-start-modal-coordinator", () => ({
  buildSessionStartModalDescription: () => "description",
  buildSessionStartModalTitle: () => "title",
  toSessionStartPostAction: () => "none",
  useSessionStartModalCoordinator: () => ({
    intent: null,
    isOpen: true,
    selection: null,
    selectedRuntimeKind: "opencode",
    runtimeOptions: [],
    supportsProfiles: false,
    supportsVariants: false,
    isCatalogLoading: false,
    agentOptions: [],
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    openStartModal: openStartModalMock,
    closeStartModal: closeStartModalMock,
    handleSelectRuntime: mock(() => {}),
    handleSelectAgent: mock(() => {}),
    handleSelectModel: mock(() => {}),
    handleSelectVariant: mock(() => {}),
  }),
}));

type AgentStudioSessionStartModalBridgeComponent =
  typeof import("./agents-page-session-start-modal-bridge")["AgentStudioSessionStartModalBridge"];

let AgentStudioSessionStartModalBridge: AgentStudioSessionStartModalBridgeComponent;

const createRequest = (requestId: string) => ({
  requestId,
  taskId: createTaskCardFixture({ id: "task-1" }).id,
  role: "build" as const,
  scenario: "build_implementation_start" as const,
  startMode: "fresh" as const,
  reason: "scenario_kickoff" as const,
  selectedModel: null,
});

beforeEach(async () => {
  openStartModalMock.mockClear();
  closeStartModalMock.mockClear();

  ({ AgentStudioSessionStartModalBridge } = await import(
    "./agents-page-session-start-modal-bridge"
  ));
});

describe("AgentStudioSessionStartModalBridge", () => {
  test("reopens the modal coordinator when a replacement request arrives", async () => {
    const onResolve = mock(() => {});
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(AgentStudioSessionStartModalBridge, {
          request: createRequest("session-start-0"),
          activeRepo: "/repo",
          repoSettings: null,
          onResolve,
        }),
      );
    });

    try {
      expect(openStartModalMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderer.update(
          createElement(AgentStudioSessionStartModalBridge, {
            request: createRequest("session-start-1"),
            activeRepo: "/repo",
            repoSettings: null,
            onResolve,
          }),
        );
      });

      expect(openStartModalMock).toHaveBeenCalledTimes(2);
      expect(openStartModalMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
        }),
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});
