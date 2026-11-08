import { expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FeatureTourProvider,
  useFeatureTourState,
} from "@/features/feature-tour/feature-tour-context";
import { GeneralSettingsSection } from "./settings-general-section";
import { type SettingsDialogHandoff, SettingsDialogHandoffContext } from "./settings-modal-context";

test("general settings retain app updates without the obsolete background-tab preference", () => {
  const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { disabled: false }));
  expect(html).toContain("General settings");
  expect(html).not.toContain("task tab");
  // Without the handoff of the shared Settings, General has no Feature tour row.
  expect(html).not.toContain("Show tour");
});

function TourState(): ReactElement {
  const { open, returnFocus } = useFeatureTourState();
  return createElement("output", null, `${open}:${returnFocus?.id ?? "none"}`);
}

test("Show tour hands Settings to the tour and is disabled while Settings saves", () => {
  const opener = document.createElement("button");
  opener.id = "settings-opener";
  const handoff = mock<SettingsDialogHandoff>((openDialog) => openDialog(opener));
  const renderSection = (disabled: boolean) =>
    createElement(
      FeatureTourProvider,
      null,
      createElement(
        SettingsDialogHandoffContext.Provider,
        { value: handoff },
        createElement(GeneralSettingsSection, { disabled }),
      ),
      createElement(TourState),
    );
  const view = render(renderSection(false));
  try {
    expect(view.getByText("See the main parts of OpenDucktor again.")).toBeDefined();
    expect(view.getByText("false:none")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Show tour" }));
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(view.getByText("true:settings-opener")).toBeDefined();

    view.rerender(renderSection(true));
    expect(view.getByRole("button", { name: "Show tour" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
  }
});
