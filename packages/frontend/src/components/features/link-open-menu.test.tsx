import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  closeLinkMenu,
  type InAppLinkTarget,
  linkMenuRequest,
  openClickedLink,
  registerInAppLinkTarget,
} from "@/lib/link-open";
import { LinkOpenMenu } from "./link-open-menu";

const URL_TO_OPEN = "https://docs.example.com/guide";
const PLAIN = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const originalPlatform = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");
const cleanups: Array<() => void> = [];

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  act(() => closeLinkMenu());
  // The test platform is an own property over the getter of the navigator prototype.
  if (originalPlatform) Object.defineProperty(globalThis.navigator, "platform", originalPlatform);
  else Reflect.deleteProperty(globalThis.navigator, "platform");
});

const showMenu = async (blockedReason: string | null = null) => {
  const opened: string[] = [];
  const target: InAppLinkTarget = {
    blockedReason,
    open: async (url) => {
      opened.push(url);
    },
  };
  cleanups.push(registerInAppLinkTarget(target));
  render(<LinkOpenMenu />);
  await act(() => openClickedLink(URL_TO_OPEN, PLAIN, { x: 10, y: 10, width: 40, height: 14 }));
  return { opened };
};

describe("LinkOpenMenu", () => {
  test("shows the link with both browsers and their shortcuts", async () => {
    await showMenu();

    const menu = await screen.findByRole("dialog", { name: "Open link" });
    expect(menu.textContent).toContain(URL_TO_OPEN);
    expect(screen.getByRole("button", { name: /System browser/ }).textContent).toContain("⌘Click");
    expect(screen.getByRole("button", { name: /OpenDucktor browser/ }).textContent).toContain(
      "⇧⌘Click",
    );
  });

  test("opens the link in a browser tab and closes", async () => {
    const { opened } = await showMenu();

    fireEvent.click(await screen.findByRole("button", { name: /OpenDucktor browser/ }));

    await waitFor(() => expect(opened).toEqual([URL_TO_OPEN]));
    expect(linkMenuRequest()).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Open link" })).toBeNull());
  });

  test("says why the page cannot open a browser tab", async () => {
    await showMenu("Close a browser tab to open another one.");

    const button = await screen.findByRole("button", { name: /OpenDucktor browser/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toContain("Close a browser tab to open another one.");
  });
});
