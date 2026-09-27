import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Stepper } from "./stepper";

test("stepper lets users return to completed stages but not skip ahead", () => {
  const onStepChange = mock((_step: "repository" | "information" | "models") => {});
  render(
    <Stepper
      label="Setup stages"
      steps={[
        { id: "repository", title: "Repository", description: "Choose a folder" },
        { id: "information", title: "Details", description: "Name the workspace" },
        { id: "models", title: "Models", description: "Choose defaults" },
      ]}
      step="information"
      onStepChange={onStepChange}
    />,
  );

  const stages = screen.getByRole("list", { name: "Setup stages" });
  expect(stages.querySelector('[aria-current="step"]')?.textContent).toContain("Details");
  fireEvent.click(within(stages).getByRole("button", { name: /Repository/ }));
  expect(onStepChange).toHaveBeenCalledWith("repository");
  expect(within(stages).getByRole<HTMLButtonElement>("button", { name: /Models/ }).disabled).toBe(
    true,
  );
});
