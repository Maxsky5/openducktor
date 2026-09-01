import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { withMockedToast } from "@/test-utils/mock-toast";
import type { NotificationDispatchFailure } from "./notification-policy";
import { NotificationFailurePrompt } from "./notification-failure-prompt";

afterEach(cleanup);

const failure = (occurrenceId: string): NotificationDispatchFailure => ({
  channel: "os",
  kind: "agent.session_started",
  occurrenceId,
  repoPath: "/repo",
  message: "Native notifications are unavailable.",
});

describe("NotificationFailurePrompt", () => {
  test("shows one actionable toast for each OS failure occurrence", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const onOpenSettings = mock(() => {});
      const onReload = mock(() => {});
      const firstFailure = failure("failure-1");
      const view = render(
        <NotificationFailurePrompt
          failure={firstFailure}
          onOpenSettings={onOpenSettings}
          onReload={onReload}
        />,
      );

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      view.rerender(
        <NotificationFailurePrompt
          failure={firstFailure}
          onOpenSettings={onOpenSettings}
          onReload={onReload}
        />,
      );
      expect(toastErrorMock).toHaveBeenCalledTimes(1);

      const options = toastErrorMock.mock.calls[0]?.[1];
      expect(options).toMatchObject({
        id: "notification-os-delivery-failure",
        description: "Native notifications are unavailable.",
        action: { label: "Open settings" },
      });
      // SAFETY: The assertion above proves that the recorded toast options contain this action.
      const action = options as { action: { onClick(): void } };
      action.action.onClick();
      expect(onOpenSettings).toHaveBeenCalledTimes(1);

      view.rerender(
        <NotificationFailurePrompt
          failure={failure("failure-2")}
          onOpenSettings={onOpenSettings}
          onReload={onReload}
        />,
      );
      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(2));
    });
  });

  test("offers a reload action for browser coordination failures", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const onOpenSettings = mock(() => {});
      const onReload = mock(() => {});
      render(
        <NotificationFailurePrompt
          failure={{ ...failure("coordination-failure"), channel: "coordination" }}
          onOpenSettings={onOpenSettings}
          onReload={onReload}
        />,
      );

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      const options = toastErrorMock.mock.calls[0]?.[1];
      expect(toastErrorMock.mock.calls[0]?.[0]).toBe("Browser notification coordination failed");
      expect(options).toMatchObject({
        id: "notification-coordination-failure",
        action: { label: "Reload" },
      });
      // SAFETY: The assertion above proves that the recorded toast options contain this action.
      const action = options as { action: { onClick(): void } };
      action.action.onClick();
      expect(onReload).toHaveBeenCalledTimes(1);
      expect(onOpenSettings).not.toHaveBeenCalled();
    });
  });
});
