import { describe, expect, test } from "bun:test";
import vm from "node:vm";
import {
  PAGE_NOTIFICATION_BINDING,
  PAGE_NOTIFICATION_SCRIPT,
  readPageNotification,
} from "./electron-browser-page-notifications";

class NativeNotification {
  static answer = "granted";
  static shown = 0;

  constructor() {
    NativeNotification.shown += 1;
  }

  static requestPermission(): Promise<string> {
    return Promise.resolve(NativeNotification.answer);
  }
}

/** Loads the script in a page world and returns a function that runs page code there. */
const loadPage = (answer: string) => {
  NativeNotification.answer = answer;
  NativeNotification.shown = 0;
  const sent: string[] = [];
  const context = vm.createContext({
    EventTarget,
    Event,
    TypeError,
    Date,
    setTimeout,
    Notification: NativeNotification,
    [PAGE_NOTIFICATION_BINDING]: (payload: string) => sent.push(payload),
  });
  vm.runInContext(PAGE_NOTIFICATION_SCRIPT, context);
  return { sent, run: (code: string) => vm.runInContext(code, context) };
};

describe("page notification script", () => {
  test("hides the binding and starts with the default permission", () => {
    const page = loadPage("granted");
    expect(page.run(`typeof ${PAGE_NOTIFICATION_BINDING}`)).toBe("undefined");
    expect(page.run("Notification.permission")).toBe("default");
    expect(page.run("Notification.name")).toBe("Notification");
  });

  test("reports a notification through the binding after the user grants it", async () => {
    const page = loadPage("granted");
    page.run("new Notification('Too early', { body: 'x' })");
    expect(page.sent).toEqual([]);

    expect(await page.run("Notification.requestPermission()")).toBe("granted");
    expect(page.run("Notification.permission")).toBe("granted");
    page.run("new Notification('Build done', { body: 'All checks passed' })");

    expect(page.sent).toEqual(['{"title":"Build done","body":"All checks passed"}']);
    expect(NativeNotification.shown).toBe(0);
  });

  test("keeps notifications silent after the user denies them", async () => {
    const page = loadPage("denied");
    expect(await page.run("Notification.requestPermission()")).toBe("denied");
    page.run("new Notification('Hidden')");
    expect(page.sent).toEqual([]);
    expect(() => page.run("new Notification()")).toThrow("1 argument required");
  });
});

describe("readPageNotification", () => {
  const bindingEvent = (payload: string, sessionId = "", name = PAGE_NOTIFICATION_BINDING) => ({
    method: "Runtime.bindingCalled",
    params: { name, payload, executionContextId: 1 },
    sessionId,
  });

  test("ignores other sessions, other bindings, and bad payloads", () => {
    expect(readPageNotification(bindingEvent('{"title":"Hi","body":""}', "S1"))).toBeNull();
    expect(
      readPageNotification(bindingEvent('{"title":"Hi","body":""}', "", "__openducktorHost")),
    ).toBeNull();
    expect(readPageNotification(bindingEvent("not json"))).toBeNull();
    expect(readPageNotification(bindingEvent('{"title":1,"body":""}'))).toBeNull();
    expect(
      readPageNotification({ method: "Page.loadEventFired", params: {}, sessionId: "" }),
    ).toBeNull();
  });
});
