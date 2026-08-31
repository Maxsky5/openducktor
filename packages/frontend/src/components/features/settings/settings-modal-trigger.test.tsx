import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsModalOpenButton } from "./settings-modal-trigger";

afterEach(cleanup);

describe("SettingsModalOpenButton", () => {
  test("opens provider-owned settings without a dialog trigger", () => {
    const onClick = mock(() => {});

    render(
      <SettingsModalOpenButton iconOnly={false} label="Settings" size="sm" onClick={onClick} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
