import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserFileChooserBar } from "./browser-file-chooser-bar";
import type { BrowserPromptOf } from "./browser-component-types";

const chooserPrompt = (
  overrides: Partial<BrowserPromptOf<"file_chooser">> = {},
): BrowserPromptOf<"file_chooser"> => ({
  promptId: "prompt-1",
  kind: "file_chooser",
  multiple: false,
  accept: [],
  startedByAgent: false,
  ...overrides,
});

describe("BrowserFileChooserBar", () => {
  test("opens the OS file dialog and says when an agent action opened the chooser", () => {
    const onChooseFiles = mock(() => {});
    const onCancel = mock(() => {});
    render(
      <BrowserFileChooserBar
        prompt={chooserPrompt({ multiple: true, startedByAgent: true })}
        busy={false}
        error={null}
        onCancel={onCancel}
        onChooseFiles={onChooseFiles}
      />,
    );

    expect(screen.getByRole("region").textContent).toContain(
      "An agent action opened a file chooser. Agents cannot choose files",
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChooseFiles).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("disables the actions while busy and shows the allowed types and an error", () => {
    render(
      <BrowserFileChooserBar
        prompt={chooserPrompt({ accept: ["image/*", ".pdf"] })}
        busy
        error="The page refused the files."
        onCancel={() => {}}
        onChooseFiles={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Choose a file" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("The page refused the files.");
    expect(screen.getByText("Allowed types: image/*, .pdf")).toBeTruthy();
    expect(screen.getByRole("region").textContent).toContain("The page asks for a file.");
  });
});
