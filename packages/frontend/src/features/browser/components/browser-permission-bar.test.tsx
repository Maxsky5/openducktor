import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrowserPermissionBar } from "./browser-permission-bar";
import type { BrowserPromptOf } from "./browser-component-types";

const cameraPrompt = (): BrowserPromptOf<"permission"> => ({
  promptId: "prompt-1",
  kind: "permission",
  origin: "http://localhost:3000",
  permission: "camera",
});

describe("BrowserPermissionBar", () => {
  test("names the site and the permission and sends the answer", async () => {
    const onAnswer = mock(async (_allow: boolean) => {});
    render(<BrowserPermissionBar prompt={cameraPrompt()} onAnswer={onAnswer} />);

    expect(screen.getByRole("region").textContent).toContain(
      "http://localhost:3000 asks to use the camera.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    });
    expect(onAnswer).toHaveBeenCalledWith(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    });
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  test("disables both answers while one runs and shows a rejected answer", async () => {
    let rejectAnswer: (cause: Error) => void = () => {};
    const onAnswer = mock(
      (_allow: boolean) =>
        new Promise<void>((_resolve, reject) => {
          rejectAnswer = reject;
        }),
    );
    render(<BrowserPermissionBar prompt={cameraPrompt()} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectAnswer(new Error("The prompt is gone."));
    });

    expect(screen.getByRole("alert").textContent).toBe("The prompt is gone.");
    expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled")).toBe(false);
  });
});
