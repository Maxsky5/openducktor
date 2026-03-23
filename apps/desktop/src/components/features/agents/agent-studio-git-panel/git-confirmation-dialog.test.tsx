import { beforeEach, describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ArrowUp } from "lucide-react";
import { act } from "react";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("GitConfirmationDialog", () => {
  let GitConfirmationDialog: typeof import("./git-confirmation-dialog")["GitConfirmationDialog"];

  beforeEach(async () => {
    ({ GitConfirmationDialog } = await import("./git-confirmation-dialog"));
  });

  test("keeps the normal confirm label when disabled but not pending", async () => {
    const rendered = render(
      <GitConfirmationDialog
        open
        onOpenChange={() => {}}
        title="Confirm force push"
        description="Force push description"
        closeDisabled={false}
        onClose={() => {}}
        closeTestId="close-button"
        confirmLabel="Force push with lease"
        confirmPendingLabel="Force pushing..."
        confirmPending={false}
        confirmDisabled
        onConfirm={() => {}}
        confirmTestId="confirm-button"
        confirmIcon={ArrowUp}
        contentTestId="dialog"
      >
        <div>Body</div>
      </GitConfirmationDialog>,
    );

    const confirmButton = screen.getByTestId("confirm-button");

    expect(confirmButton.textContent).toContain("Force push with lease");
    expect(confirmButton.textContent).not.toContain("Force pushing...");
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      rendered.unmount();
    });
  });

  test("shows the pending confirm label only when pending is true", async () => {
    const rendered = render(
      <GitConfirmationDialog
        open
        onOpenChange={() => {}}
        title="Confirm force push"
        description="Force push description"
        closeDisabled={false}
        onClose={() => {}}
        closeTestId="close-button"
        confirmLabel="Force push with lease"
        confirmPendingLabel="Force pushing..."
        confirmPending
        confirmDisabled
        onConfirm={() => {}}
        confirmTestId="confirm-button"
        confirmIcon={ArrowUp}
        contentTestId="dialog"
      >
        <div>Body</div>
      </GitConfirmationDialog>,
    );

    const confirmButton = screen.getByTestId("confirm-button");

    expect(confirmButton.textContent).toContain("Force pushing...");
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      rendered.unmount();
    });
  });
});
