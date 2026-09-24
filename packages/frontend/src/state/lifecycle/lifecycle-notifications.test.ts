import { describe, expect, test } from "bun:test";
import { toast } from "sonner";
import { lifecycleNotifications } from "./lifecycle-notifications";

describe("lifecycle notifications", () => {
  test("uses a persistent normal toast for closable loading feedback", () => {
    const toastId = lifecycleNotifications.loading(
      "Preparing task store",
      "OpenDucktor is opening the SQLite task store for this repository.",
    );

    try {
      const notification = toast.getToasts().find((item) => item.id === toastId);
      if (!notification || !("type" in notification)) {
        throw new Error("Expected the task-store preparation toast to exist.");
      }

      expect(notification.type).not.toBe("loading");
      expect(notification.icon).toBeTruthy();
      expect(notification.duration).toBe(Infinity);
      expect(notification.closeButton).toBe(true);
      expect(notification.dismissible).toBe(true);
    } finally {
      lifecycleNotifications.dismiss(toastId);
    }
  });
});
