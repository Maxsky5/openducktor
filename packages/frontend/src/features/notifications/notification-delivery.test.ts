import { describe, expect, mock, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { ArrowUpRight } from "lucide-react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(options?.action?.label).toMatchObject({
      type: "span",
      props: {
        children: [
          "Open",
          expect.objectContaining({
            type: ArrowUpRight,
            props: expect.objectContaining({ "aria-hidden": true }),
          }),
        ],
      },
    });
    options?.action?.onClick();
    expect(navigate).toHaveBeenCalledWith(occurrence.navigationTarget);
  });

  // A real Sonner portal render and close transition exceed the workspace's 1-second unit-test limit on CI.
  test("renders agent notifications with the shared close control and full-width action", async () => {
    const navigate = mock(async () => {});
    let toastId: string | number | undefined;
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
      await act(async () => {
        await adapter.deliver({ title, body: "Repo - Build notifications" }, occurrence);
      });

      const closeButton = await screen.findByRole(
        "button",
        { name: "Close toast" },
        { timeout: 2_000 },
      );
      const openButton = screen.getByRole("button", { name: "Open" });
      const toastElement = screen.getByText(title).closest("[data-sonner-toast]");

      if (!toastElement) {
        throw new Error("The agent notification toast was not rendered");
      }

      const content = toastElement.querySelector("[data-content]");
      if (!content) {
        throw new Error("The agent notification content was not rendered");
      }

      expect(closeButton.className).toContain("opacity-100");
      expect(content.className).toContain("pr-7");
      expect(toastElement.className).toContain("!flex-col");
      expect(openButton.className).toContain("!w-full");
      expect(openButton.className).toContain("!bg-primary");
      expect(openButton.className).toContain("!text-primary-foreground");
      expect(closeButton.closest("[data-sonner-toast]")).toBe(toastElement);
      expect(Array.from(toastElement.children).indexOf(content)).toBeLessThan(
        Array.from(toastElement.children).indexOf(openButton),
      );

      fireEvent.click(closeButton);
      await waitFor(
        () => {
          expect(toastElement.getAttribute("data-removed")).toBe("true");
        },
        { timeout: 2_000 },
      );
    } finally {
      if (toastId !== undefined) {
        act(() => toast.dismiss(toastId));
      }
    }
  }, 5_000);

  test("plays Cuelume through its imperative API with a normalized volume", async () => {
    const play = mock((_sound?: string, _options?: { volume?: number }) => {});
    const adapter = createCuelumeNotificationSoundAdapter(play);

    await adapter.play("arrival", 65);

    expect(play).toHaveBeenCalledWith("arrival", { volume: 0.65 });
  });

  test("unlocks Cuelume once from the first pointer or keyboard gesture", () => {
    const play = mock((_sound?: string, _options?: { volume?: number }) => {});
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    } satisfies GestureTarget;

    const dispose = installCuelumeGestureUnlock({ play, target });
    listeners.get("pointerdown")?.(new Event("pointerdown"));
    listeners.get("keydown")?.(new Event("keydown"));

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[1]?.volume).toBeGreaterThan(0);
    dispose();
  });
});
