import { describe, expect, test } from "bun:test";
import {
  createFeedbackStore,
  startupCoveredBy,
  toastsCoveredBy,
  toastWindowOf,
} from "./feedback-store";

describe("feedback store", () => {
  test("replaces a message with the same ID and keeps errors longer", () => {
    const { store, feedback } = createFeedbackStore();
    feedback.show("info", "Saving", { id: "save" });
    feedback.show("error", "Save failed", { id: "save", description: "Retry later." });
    expect(store.getState().messages).toEqual([
      {
        id: "save",
        kind: "error",
        message: "Save failed",
        description: "Retry later.",
        duration: 7_000,
      },
    ]);
  });

  test("keeps the newest three messages and supports persistent messages", () => {
    const { store, feedback, dismiss } = createFeedbackStore();
    for (const message of ["one", "two", "three", "four"]) feedback.show("success", message);
    expect(store.getState().messages.map((entry) => entry.message)).toEqual([
      "two",
      "three",
      "four",
    ]);
    feedback.show("warning", "Stays", { id: "keep", duration: Infinity });
    expect(store.getState().messages.at(-1)?.duration).toBeNull();
    dismiss("keep");
    expect(store.getState().messages.some((entry) => entry.id === "keep")).toBe(false);
  });

  test("shows the toasts in the newest open window, then in the root view again", () => {
    const { store, openWindow } = createFeedbackStore();
    const toastWindow = () => toastWindowOf(store.getState());
    expect(toastWindow()).toBeNull();
    const closeSheet = openWindow("sheet");
    const closeDialog = openWindow("dialog");
    expect(toastWindow()).toBe("dialog");
    closeSheet();
    expect(toastWindow()).toBe("dialog");
    const closeMenu = openWindow("menu");
    closeMenu();
    expect(toastWindow()).toBe("dialog");
    closeDialog();
    expect(toastWindow()).toBeNull();
  });

  test("remembers the toasts that a window showed while their messages stay", () => {
    const { store, feedback, dismiss, markPresented, wasPresented } = createFeedbackStore();
    feedback.show("success", "Task deleted", { id: "deleted" });
    expect(wasPresented("deleted")).toBe(false);
    markPresented("deleted");
    expect(wasPresented("deleted")).toBe(true);
    dismiss("deleted");
    expect(wasPresented("deleted")).toBe(false);

    markPresented("gone");
    expect(wasPresented("gone")).toBe(false);
    feedback.show("info", "first", { id: "first" });
    markPresented("first");
    for (const message of ["two", "three", "four"]) feedback.show("info", message);
    expect(store.getState().messages.some((entry) => entry.id === "first")).toBe(false);
    expect(wasPresented("first")).toBe(false);
  });

  test("hides the toasts while a menu is open, once for each menu", () => {
    const { store, openMenu } = createFeedbackStore();
    const covered = () => toastsCoveredBy(store.getState());
    const closeMenu = openMenu();
    const closeSubmenu = openMenu();
    expect(covered()).toBe(true);
    closeSubmenu();
    closeSubmenu();
    expect(covered()).toBe(true);
    closeMenu();
    expect(covered()).toBe(false);
  });

  test("sheets cover startup cards without covering short feedback until the last sheet closes", () => {
    const { store, coverStartup } = createFeedbackStore();
    const covered = () => startupCoveredBy(store.getState());
    const closeSheet = coverStartup();
    const closeDialog = coverStartup();
    expect(covered()).toBe(true);
    expect(toastsCoveredBy(store.getState())).toBe(false);
    closeDialog();
    closeDialog();
    expect(covered()).toBe(true);
    closeSheet();
    expect(covered()).toBe(false);
  });
});
