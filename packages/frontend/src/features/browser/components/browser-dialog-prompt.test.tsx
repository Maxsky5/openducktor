import { describe, expect, mock, test } from "bun:test";
import type { BrowserDialogType, BrowserPromptAnswer } from "@openducktor/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserDialogPrompt } from "./browser-dialog-prompt";
import type { BrowserPromptOf } from "./browser-component-types";

const dialogPrompt = (
  type: BrowserDialogType,
  overrides: Partial<BrowserPromptOf<"dialog">> = {},
): BrowserPromptOf<"dialog"> => ({
  promptId: `prompt-${type}`,
  kind: "dialog",
  type,
  message: "Delete the draft?",
  defaultPrompt: "",
  startedByAgent: false,
  ...overrides,
});

const renderDialog = (prompt: BrowserPromptOf<"dialog"> | BrowserPromptOf<"leave_page">) => {
  const onAnswer = mock(async (_answer: BrowserPromptAnswer) => {});
  const returnFocus = mock(() => {});
  const view = render(
    <BrowserDialogPrompt
      prompt={prompt}
      pageUrl="http://localhost:3000/drafts"
      onAnswer={onAnswer}
      returnFocus={returnFocus}
    />,
  );
  return { onAnswer, returnFocus, view, dialog: screen.getByRole("alertdialog") };
};

/** Fires an event and lets the answer settle. */
const settle = async (fire: () => void): Promise<void> => {
  await act(async () => {
    fire();
  });
};

const buttonNames = (): string[] =>
  screen.getAllByRole("button").map((button) => button.textContent ?? "");

describe("BrowserDialogPrompt", () => {
  test("gives the focus back to the page when it closes with the focus inside", () => {
    const { returnFocus, view } = renderDialog(dialogPrompt("alert"));
    expect(document.activeElement?.textContent).toBe("OK");

    view.unmount();

    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  test("leaves the focus alone when it closes without the focus", () => {
    const { returnFocus, view } = renderDialog(dialogPrompt("alert", { startedByAgent: true }));

    view.unmount();

    expect(returnFocus).not.toHaveBeenCalled();
  });

  test("leaves the focus where it is for a dialog that an agent action opened", () => {
    for (const prompt of [
      dialogPrompt("confirm", { startedByAgent: true }),
      { promptId: "leave-2", kind: "leave_page" as const, url: null, startedByAgent: true },
    ]) {
      render(<textarea aria-label="Composer" />);
      const composer = screen.getByLabelText("Composer");
      composer.focus();

      const { dialog } = renderDialog(prompt);

      expect(document.activeElement).toBe(composer);
      expect(dialog.contains(document.activeElement)).toBe(false);
      cleanup();
    }
  });

  test("shows an alert with OK, names the site, and moves focus into the card", async () => {
    const { onAnswer } = renderDialog(dialogPrompt("alert", { message: "Saved." }));

    expect(screen.getByRole("alertdialog", { name: "localhost:3000 says" })).toBeTruthy();
    expect(screen.getByText("Saved.")).toBeTruthy();
    expect(buttonNames()).toEqual(["OK"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" }));

    await settle(() => fireEvent.click(screen.getByRole("button", { name: "OK" })));

    expect(onAnswer).toHaveBeenCalledWith({ kind: "dialog", accept: true });
  });

  test("answers a confirm with OK or Cancel, and Escape cancels", async () => {
    const { onAnswer, dialog } = renderDialog(dialogPrompt("confirm"));
    expect(buttonNames()).toEqual(["Cancel", "OK"]);

    await settle(() => fireEvent.keyDown(dialog, { key: "Escape" }));

    expect(onAnswer).toHaveBeenCalledWith({ kind: "dialog", accept: false });
  });

  test("sends the prompt text on Enter and starts with the default text", async () => {
    const { onAnswer } = renderDialog(
      dialogPrompt("prompt", { message: "Your name?", defaultPrompt: "Ada" }),
    );
    const field = screen.getByRole("textbox", { name: "Answer" });
    if (!(field instanceof HTMLInputElement)) throw new Error("Expected the answer field");
    expect(field.value).toBe("Ada");
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "Grace" } });
    await settle(() => fireEvent.submit(field));

    expect(onAnswer).toHaveBeenCalledWith({ kind: "dialog", accept: true, promptText: "Grace" });
  });

  test("asks to leave the page for beforeunload", async () => {
    const { onAnswer } = renderDialog(dialogPrompt("beforeunload", { message: "" }));

    expect(screen.getByRole("alertdialog", { name: "Leave this page?" })).toBeTruthy();
    expect(buttonNames()).toEqual(["Stay", "Leave page"]);
    await settle(() => fireEvent.click(screen.getByRole("button", { name: "Stay" })));

    expect(onAnswer).toHaveBeenCalledWith({ kind: "dialog", accept: false });
  });

  test("says that an Electron page asked to stay and repeats the navigation on Leave page", async () => {
    const { onAnswer, dialog } = renderDialog({
      promptId: "leave-1",
      kind: "leave_page",
      url: "http://localhost:3000/next",
      startedByAgent: false,
    });

    expect(dialog.textContent).toContain("The page asked to stay, so it is still open.");
    await settle(() => {
      fireEvent.click(screen.getByRole("button", { name: "Leave page" }));
      // A second answer while the first one runs does nothing.
      fireEvent.keyDown(dialog, { key: "Escape" });
    });

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ kind: "leave_page", leave: true });
  });

  test("shows a rejected answer and keeps the card", async () => {
    const onAnswer = mock(async (_answer: BrowserPromptAnswer) => {
      throw new Error("No dialog is open.");
    });
    render(
      <BrowserDialogPrompt
        prompt={dialogPrompt("alert")}
        pageUrl="about:blank"
        onAnswer={onAnswer}
        returnFocus={() => {}}
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "This page says" })).toBeTruthy();
    await settle(() => fireEvent.click(screen.getByRole("button", { name: "OK" })));

    expect(screen.getByRole("alert").textContent).toBe("No dialog is open.");
  });
});
