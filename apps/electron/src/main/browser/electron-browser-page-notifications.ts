import type { CdpConnection, CdpEvent } from "@openducktor/host";
import { type JSONType, z } from "zod";

/** The page binding that the notification script calls. The script removes it from the page. */
export const PAGE_NOTIFICATION_BINDING = "__openducktorNotify";

/**
 * Replaces `Notification` in the main world of each document before page scripts run. A granted
 * notification goes to the engine as JSON through the binding, never to the OS. The script keeps
 * its own permission state, because the engine denies every notification permission check.
 */
export const PAGE_NOTIFICATION_SCRIPT = `(() => {
  const notify = globalThis.${PAGE_NOTIFICATION_BINDING};
  if (!notify) return;
  delete globalThis.${PAGE_NOTIFICATION_BINDING};
  const NativeNotification = globalThis.Notification;
  if (!NativeNotification) return;
  const requestNativePermission = NativeNotification.requestPermission.bind(NativeNotification);
  let permission = "default";
  const text = (value, fallback) => (value === undefined || value === null ? fallback : String(value));
  class Notification extends EventTarget {
    constructor(title, options) {
      super();
      if (arguments.length === 0) {
        throw new TypeError("Failed to construct 'Notification': 1 argument required, but only 0 present.");
      }
      const settings = options || {};
      this.title = String(title);
      this.body = text(settings.body, "");
      this.tag = text(settings.tag, "");
      this.icon = text(settings.icon, "");
      this.badge = text(settings.badge, "");
      this.image = text(settings.image, "");
      this.lang = text(settings.lang, "");
      this.dir = text(settings.dir, "auto");
      this.data = settings.data === undefined ? null : settings.data;
      this.silent = settings.silent === undefined ? null : Boolean(settings.silent);
      this.requireInteraction = Boolean(settings.requireInteraction);
      this.timestamp = Date.now();
      this.onclick = null;
      this.onshow = null;
      this.onerror = null;
      this.onclose = null;
      const shown = permission === "granted";
      if (shown) notify(JSON.stringify({ title: this.title, body: this.body }));
      setTimeout(() => this.dispatchEvent(new Event(shown ? "show" : "error")), 0);
    }
    static get permission() {
      return permission;
    }
    static get maxActions() {
      return 0;
    }
    static requestPermission(callback) {
      return requestNativePermission().then((result) => {
        permission = result;
        if (callback) callback(result);
        return result;
      });
    }
    close() {
      setTimeout(() => this.dispatchEvent(new Event("close")), 0);
    }
    dispatchEvent(event) {
      const handled = super.dispatchEvent(event);
      const handler = this["on" + event.type];
      if (handler) handler.call(this, event);
      return handled;
    }
  }
  Object.defineProperty(globalThis, "Notification", {
    value: Notification,
    writable: true,
    configurable: true,
    enumerable: false,
  });
})();`;

/** Installs the notification script through the root debugger session of a page. */
export const installPageNotifications = async (connection: CdpConnection): Promise<void> => {
  await connection.request("Page.enable", undefined, "");
  await connection.request("Runtime.enable", undefined, "");
  await connection.request("Runtime.addBinding", { name: PAGE_NOTIFICATION_BINDING }, "");
  await connection.request(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: PAGE_NOTIFICATION_SCRIPT, runImmediately: true },
    "",
  );
};

const bindingCallSchema = z.object({ name: z.string(), payload: z.string() });
const notificationPayloadSchema = z.strictObject({
  title: z.string().max(1_024),
  body: z.string().max(4_096),
});

export type PageNotification = z.infer<typeof notificationPayloadSchema>;

/** Reads a page notification from a root session event, or `null` for another event. */
export const readPageNotification = (event: CdpEvent): PageNotification | null => {
  if (event.sessionId !== "" || event.method !== "Runtime.bindingCalled") {
    return null;
  }
  const call = bindingCallSchema.safeParse(event.params);
  if (!call.success || call.data.name !== PAGE_NOTIFICATION_BINDING) {
    return null;
  }
  let payload: JSONType;
  try {
    payload = JSON.parse(call.data.payload);
  } catch {
    return null;
  }
  const notification = notificationPayloadSchema.safeParse(payload);
  return notification.success ? notification.data : null;
};
