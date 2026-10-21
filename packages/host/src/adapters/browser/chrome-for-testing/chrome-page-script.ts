import { type BrowserPermissionKind, browserPermissionKindSchema } from "@openducktor/contracts";
import { z } from "zod";

/** The `Runtime.addBinding` function. The page script removes it before page code runs. */
export const CHROME_PAGE_BINDING = "__odtBrowserEngineRequest";
/** The page function that lets a waiting permission call continue. */
const CHROME_PAGE_ANSWER = "__odtBrowserEngineAnswer";

const TEXT_LIMIT = 1_000;

/**
 * Main-world script for each document of a tab. Chrome has no CDP event for permission prompts,
 * so the script asks the engine through the binding before each prompted API call. The engine
 * applies the answer with `Browser.setPermission`, then calls the answer function, and the page
 * call continues with the saved Chrome permission. `--deny-permission-prompts` denies every other
 * permission prompt. Device choosers and the screen capture picker are not prompts: headless Chrome
 * keeps them open, so the script denies them at once. The script also reports the notifications of
 * granted pages.
 */
export const CHROME_PAGE_SCRIPT = `(() => {
  const send = globalThis[${JSON.stringify(CHROME_PAGE_BINDING)}];
  if (typeof send !== "function") return;
  delete globalThis[${JSON.stringify(CHROME_PAGE_BINDING)}];
  const waiting = new Map();
  let nextRequestId = 1;
  Object.defineProperty(globalThis, ${JSON.stringify(CHROME_PAGE_ANSWER)}, {
    value: (requestId) => {
      const resume = waiting.get(requestId);
      waiting.delete(requestId);
      if (resume) resume();
    },
  });
  const ask = (permission) =>
    new Promise((resolve) => {
      const requestId = nextRequestId++;
      waiting.set(requestId, resolve);
      send(JSON.stringify({ type: "permission", requestId, permission }));
    });
  const askAll = (permissions) =>
    permissions.reduce((previous, permission) => previous.then(() => ask(permission)), Promise.resolve());
  const text = (value) => String(value ?? "").slice(0, ${TEXT_LIMIT});
  const report = (title, options) =>
    send(JSON.stringify({ type: "notification", title: text(title), body: text(options && options.body) }));

  const media = globalThis.MediaDevices && MediaDevices.prototype;
  if (media && media.getUserMedia) {
    const getUserMedia = media.getUserMedia;
    media.getUserMedia = function (constraints) {
      const permissions = [];
      if (constraints && constraints.video) permissions.push("camera");
      if (constraints && constraints.audio) permissions.push("microphone");
      return askAll(permissions).then(() => getUserMedia.call(this, constraints));
    };
  }

  const geolocation = globalThis.Geolocation && Geolocation.prototype;
  if (geolocation) {
    const getCurrentPosition = geolocation.getCurrentPosition;
    const watchPosition = geolocation.watchPosition;
    const clearWatch = geolocation.clearWatch;
    const watches = new Map();
    let nextWatchId = 1;
    geolocation.getCurrentPosition = function (success, error, options) {
      ask("geolocation").then(() => getCurrentPosition.call(this, success, error, options));
    };
    geolocation.watchPosition = function (success, error, options) {
      const watchId = nextWatchId++;
      const watch = { nativeId: null };
      watches.set(watchId, watch);
      ask("geolocation").then(() => {
        if (watches.get(watchId) === watch) watch.nativeId = watchPosition.call(this, success, error, options);
      });
      return watchId;
    };
    geolocation.clearWatch = function (watchId) {
      const watch = watches.get(watchId);
      watches.delete(watchId);
      if (watch && watch.nativeId !== null) clearWatch.call(this, watch.nativeId);
    };
  }

  const clipboard = globalThis.Clipboard && Clipboard.prototype;
  if (clipboard) {
    for (const name of ["read", "readText"]) {
      const read = clipboard[name];
      if (read) {
        clipboard[name] = function () {
          return ask("clipboard_read").then(() => read.call(this));
        };
      }
    }
  }

  const NativeNotification = globalThis.Notification;
  if (NativeNotification) {
    const requestPermission = NativeNotification.requestPermission;
    class Notification extends NativeNotification {
      constructor(title, options) {
        super(title, options);
        if (NativeNotification.permission === "granted") report(title, options);
      }
      static requestPermission(callback) {
        const result = ask("notifications").then(() => requestPermission.call(NativeNotification));
        if (typeof callback === "function") result.then(callback);
        return result;
      }
    }
    Object.defineProperty(globalThis, "Notification", { value: Notification, writable: true, configurable: true });
  }

  const deny = () =>
    Promise.reject(new DOMException("OpenDucktor browser tabs deny this permission.", "NotAllowedError"));
  for (const [owner, name] of [
    ["USB", "requestDevice"],
    ["Serial", "requestPort"],
    ["HID", "requestDevice"],
    ["Bluetooth", "requestDevice"],
    ["MediaDevices", "getDisplayMedia"],
  ]) {
    const prototype = globalThis[owner] && globalThis[owner].prototype;
    if (prototype && prototype[name]) prototype[name] = deny;
  }

  const registration = globalThis.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype;
  if (registration && registration.showNotification) {
    const showNotification = registration.showNotification;
    registration.showNotification = function (title, options) {
      return showNotification.call(this, title, options).then((value) => {
        report(title, options);
        return value;
      });
    };
  }
})();`;

const chromePageMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("permission"),
    requestId: z.number().int().positive(),
    permission: browserPermissionKindSchema,
  }),
  z.object({
    type: z.literal("notification"),
    title: z.string().max(TEXT_LIMIT),
    body: z.string().max(TEXT_LIMIT),
  }),
]);
type ChromePageMessage = z.infer<typeof chromePageMessageSchema>;

/** Reads one binding payload. Page code can call the binding too, so a bad payload is ignored. */
export const parseChromePageMessage = (payload: string): ChromePageMessage | null => {
  try {
    const result = chromePageMessageSchema.safeParse(JSON.parse(payload));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/** The `Browser.PermissionDescriptor` name of each permission that a page can ask for. */
export const chromePermissionName = (permission: BrowserPermissionKind): string => {
  switch (permission) {
    case "camera":
      return "camera";
    case "microphone":
      return "microphone";
    case "geolocation":
      return "geolocation";
    case "notifications":
      return "notifications";
    case "clipboard_read":
      return "clipboard-read";
  }
};

/** The expression that lets the page call with this request ID continue. */
export const chromePageAnswerExpression = (requestId: number): string =>
  `globalThis[${JSON.stringify(CHROME_PAGE_ANSWER)}](${requestId})`;
