import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  closeLinkMenu,
  type InAppLinkTarget,
  linkMenuRequest,
  linkOpenChoiceForClick,
  openClickedLink,
  registerInAppLinkTarget,
} from "./link-open";
import { configureShellBridge, createUnavailableShellBridge } from "./shell-bridge";

const URL_TO_OPEN = "http://localhost:3000/docs";
const ANCHOR = { x: 10, y: 20, width: 30, height: 12 };
const PLAIN = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const originalPlatform = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");

const usePlatform = (platform: string): void => {
  Object.defineProperty(globalThis.navigator, "platform", { configurable: true, value: platform });
};

const target = (blockedReason: string | null = null) => {
  const opened: string[] = [];
  const value: InAppLinkTarget = {
    blockedReason,
    open: async (url) => {
      opened.push(url);
    },
  };
  return { value, opened };
};

let systemOpened: string[] = [];
const cleanups: Array<() => void> = [];

beforeEach(() => {
  usePlatform("MacIntel");
  systemOpened = [];
  configureShellBridge(
    createShellBridgeFixture({
      bridge: {
        openExternalUrl: mock(async (url: string) => {
          systemOpened.push(url);
        }),
      },
    }),
  );
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  closeLinkMenu();
  configureShellBridge(createUnavailableShellBridge());
  // The test platform is an own property over the getter of the navigator prototype.
  if (originalPlatform) Object.defineProperty(globalThis.navigator, "platform", originalPlatform);
  else Reflect.deleteProperty(globalThis.navigator, "platform");
});

describe("link open", () => {
  test("Cmd+Click opens the system browser and Shift+Cmd+Click a browser tab on macOS", () => {
    expect(linkOpenChoiceForClick({ ...PLAIN, metaKey: true })).toBe("system");
    expect(linkOpenChoiceForClick({ ...PLAIN, metaKey: true, shiftKey: true })).toBe("app");
    expect(linkOpenChoiceForClick({ ...PLAIN, ctrlKey: true })).toBeNull();
    expect(linkOpenChoiceForClick(PLAIN)).toBeNull();
  });

  test("Ctrl is the modifier on Windows and Linux", () => {
    usePlatform("Win32");

    expect(linkOpenChoiceForClick({ ...PLAIN, ctrlKey: true })).toBe("system");
    expect(linkOpenChoiceForClick({ ...PLAIN, metaKey: true })).toBeNull();
  });

  test("a plain click shows the menu when the page has browser tabs", async () => {
    const { value } = target();
    cleanups.push(registerInAppLinkTarget(value));

    await openClickedLink(URL_TO_OPEN, PLAIN, ANCHOR);

    expect(linkMenuRequest()).toEqual({ url: URL_TO_OPEN, anchor: ANCHOR });
    expect(systemOpened).toEqual([]);
  });

  test("a plain click opens the system browser on a page without browser tabs or for mail links", async () => {
    await openClickedLink(URL_TO_OPEN, PLAIN, ANCHOR);
    const { value } = target();
    cleanups.push(registerInAppLinkTarget(value));
    await openClickedLink("mailto:team@example.com", PLAIN, ANCHOR);

    expect(systemOpened).toEqual([URL_TO_OPEN, "mailto:team@example.com"]);
    expect(linkMenuRequest()).toBeNull();
  });

  test("Shift+Cmd+Click opens a browser tab of the last page, or says why it cannot", async () => {
    const first = target();
    const second = target("Close a browser tab to open another one.");
    cleanups.push(registerInAppLinkTarget(first.value));
    const unregister = registerInAppLinkTarget(second.value);
    const shifted = { ...PLAIN, metaKey: true, shiftKey: true };

    await expect(openClickedLink(URL_TO_OPEN, shifted, ANCHOR)).rejects.toThrow(
      "Close a browser tab to open another one.",
    );
    unregister();
    await openClickedLink(URL_TO_OPEN, shifted, ANCHOR);

    expect(first.opened).toEqual([URL_TO_OPEN]);
    expect(second.opened).toEqual([]);
  });
});
