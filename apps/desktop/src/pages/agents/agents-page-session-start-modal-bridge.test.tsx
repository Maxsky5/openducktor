import { describe, expect, mock, test } from "bun:test";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useSessionStartModalRequestActivation } from "./agents-page-session-start-modal-bridge";

enableReactActEnvironment();

type UseSessionStartModalRequestActivationHook = typeof useSessionStartModalRequestActivation;
type HookArgs = Parameters<UseSessionStartModalRequestActivationHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSessionStartModalRequestActivation, initialProps);

const createRequest = (requestId: string) => ({
  requestId,
  taskId: "task-1",
  role: "build" as const,
  scenario: "build_implementation_start" as const,
  startMode: "fresh" as const,
  reason: "scenario_kickoff" as const,
  selectedModel: null,
});

describe("useSessionStartModalRequestActivation", () => {
  test("reopens the modal coordinator when a replacement request arrives", async () => {
    const openStartModal = mock(() => {});
    const harness = createHookHarness({
      request: createRequest("session-start-0"),
      openStartModal,
    });

    try {
      await harness.mount();
      expect(openStartModal).toHaveBeenCalledTimes(1);

      await harness.update({
        request: createRequest("session-start-1"),
        openStartModal,
      });

      expect(openStartModal).toHaveBeenCalledTimes(2);
      expect(openStartModal).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not reopen the modal when only the coordinator callback identity changes", async () => {
    const openStartModal = mock(() => {});
    const replacementOpenStartModal = mock(() => {});
    const harness = createHookHarness({
      request: createRequest("session-start-0"),
      openStartModal,
    });

    try {
      await harness.mount();
      expect(openStartModal).toHaveBeenCalledTimes(1);

      await harness.update({
        request: createRequest("session-start-0"),
        openStartModal: replacementOpenStartModal,
      });

      expect(openStartModal).toHaveBeenCalledTimes(1);
      expect(replacementOpenStartModal).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });
});
