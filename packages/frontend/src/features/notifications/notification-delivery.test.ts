import { describe, expect, mock, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  createCuelumeNotificationSoundAdapter,
  createSonnerNotificationAdapter,
  type GestureTarget,
  installCuelumeGestureUnlock,
} from "./notification-delivery";

const occurrence: NotificationOccurrence = {
  occurrenceId: "agent.session_started:/repo:session-1",
  kind: "agent.session_started",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Agent Session started.",
  navigationTarget: {
    type: "agent_session",
    repoPath: "/repo",
    taskId: "task-1",
    session: {
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
    },
  },
};

type TestToastOptions = {
  description: string;
  duration: number;
  closeButton: boolean;
  classNames: {
    toast: string;
    content: string;
    actionButton: string;
  };
  action: {
    label: ReactNode;
    onClick(): void;
  };
};

describe("notification delivery adapters", () => {
  test("shows a closeable 10-second toast with a full-width session action", async () => {
    const showToast = mock((_title: string, _options: TestToastOptions) => "toast-id");
    const navigate = mock(async () => {});
    const adapter = createSonnerNotificationAdapter({ showToast, navigate });

    await adapter.deliver(
      { title: "Agent Session Started - task-1", body: "Repo - Build notifications" },
      occurrence,
    );

    expect(showToast).toHaveBeenCalledTimes(1);
    const options = showToast.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      duration: 10000,
      description: "Repo - Build notifications",
      closeButton: true,
      classNames: {
        toast: "!flex-col !items-stretch",
        content: "w-full",
        actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
      },
    });
    options?.action?.onClick();
    expect(navigate).toHaveBeenCalledWith(occurrence.navigationTarget);
  });

  // Sonner renders two portal toasts and removes one through its close action.
  test("renders agent notifications with the shared close control and full-width action", async () => {
    const navigate = mock(async () => {});
    let toastId: string | number | undefined;
    let unrelatedToastId: string | number | undefined;
    const adapter = createSonnerNotificationAdapter({
      showToast: (toastTitle, options) => {
        toastId = toast(toastTitle, options);
        return toastId;
      },
      navigate,
    });
    const title = "Agent Session Started - task-1";

    render(createElement(Toaster));

    try {
      act(() => {
        unrelatedToastId = toast("Another notification");
      });

      await act(async () => {
        await adapter.deliver({ title, body: "Repo - Build notifications" }, occurrence);
      });

      const titleElement = await screen.findByText(title, {}, { timeout: 800 });
      const toastElement = titleElement.closest<HTMLElement>("[data-sonner-toast]");

      if (!toastElement) {
        throw new Error("The agent notification toast was not rendered");
      }

      const toastQueries = within(toastElement);
      const closeButton = toastQueries.getByRole("button", { name: "Close toast" });
      const openButton = toastQueries.getByRole("button", { name: "Open" });
      expect(openButton.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      const content = toastElement.querySelector("[data-content]");
      if (!content) {
        throw new Error("The agent notification content was not rendered");
      }

      expect(closeButton.className).toContain("opacity-100");
      expect(toastElement.className).toContain("!flex-col");
      expect(openButton.className).toContain("!w-full");
      expect(openButton.className).toContain("!bg-primary");
      expect(openButton.className).toContain("!text-primary-foreground");
      expect(closeButton.closest("[data-sonner-toast]")).toBe(toastElement);
      expect(Array.from(toastElement.children).indexOf(content)).toBeLessThan(
        Array.from(toastElement.children).indexOf(openButton),
      );

      fireEvent.click(closeButton);
      expect(toastElement.getAttribute("data-removed")).toBe("true");
    } finally {
      if (toastId !== undefined) {
        act(() => toast.dismiss(toastId));
      }
      if (unrelatedToastId !== undefined) {
        act(() => toast.dismiss(unrelatedToastId));
      }
    }
  }, 2_500);

  test("plays Cuelume through its imperative API with a normalized volume", async () => {
    const play = mock((_sound?: string, _options?: { volume?: number }) => {});
    const adapter = createCuelumeNotificationSoundAdapter(play);

    await adapter.play("arrival", 65);

    expect(play).toHaveBeenCalledWith("navigate", { volume: 0.65 });
  });

  test.each(["pointerdown", "keydown"])(
    "unlocks audio without playing a cue on the first %s gesture",
    (gesture) => {
      const unlock = mock(async () => true);
      const listeners = new Map<string, EventListener>();
      const target = {
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      } satisfies GestureTarget;

      const dispose = installCuelumeGestureUnlock({ unlock, target });
      const firstGesture = listeners.get(gesture);
      firstGesture?.(new Event(gesture));
      firstGesture?.(new Event(gesture));

      expect(unlock).toHaveBeenCalledTimes(1);
      expect(listeners.size).toBe(0);
      dispose();
    },
  );
});
