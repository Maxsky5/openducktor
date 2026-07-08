import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AppearanceSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsAppearanceSection } from "./settings-appearance-section";

enableReactActEnvironment();

const createAppearanceSettings = (
  overrides: Partial<AppearanceSettings> = {},
): AppearanceSettings => ({
  horizontalScrollbarVisibility: "system",
  ...overrides,
});

const renderAppearanceSection = (appearance: AppearanceSettings, disabled = false): void => {
  let latestAppearance = appearance;
  const onUpdateAppearance = mock(
    (updater: (current: AppearanceSettings) => AppearanceSettings): void => {
      latestAppearance = updater(latestAppearance);
    },
  );

  render(
    <SettingsAppearanceSection
      appearance={latestAppearance}
      disabled={disabled}
      onUpdateAppearance={onUpdateAppearance}
    />,
  );
};

const renderAppearanceSectionWithUpdates = (appearance: AppearanceSettings) => {
  let latestAppearance = appearance;
  const onUpdateAppearance = mock(
    (updater: (current: AppearanceSettings) => AppearanceSettings): void => {
      latestAppearance = updater(latestAppearance);
    },
  );

  const rendered = render(
    <SettingsAppearanceSection
      appearance={latestAppearance}
      disabled={false}
      onUpdateAppearance={onUpdateAppearance}
    />,
  );

  return {
    onUpdateAppearance,
    getLatestAppearance: () => latestAppearance,
    rerenderLatest: () => {
      rendered.rerender(
        <SettingsAppearanceSection
          appearance={latestAppearance}
          disabled={false}
          onUpdateAppearance={onUpdateAppearance}
        />,
      );
    },
  };
};

const changeHorizontalScrollbarVisibility = async (
  value: AppearanceSettings["horizontalScrollbarVisibility"],
): Promise<void> => {
  const labelByValue = {
    system: "System default",
    show: "Show",
    hide: "Hide",
  } satisfies Record<AppearanceSettings["horizontalScrollbarVisibility"], string>;

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Horizontal Scrollbars" }));
  });

  const matchingLabels = await screen.findAllByText(labelByValue[value]);
  await act(async () => {
    const optionLabel = matchingLabels.at(-1);
    if (!optionLabel) {
      throw new Error(`Expected ${labelByValue[value]} option to be rendered`);
    }
    fireEvent.click(optionLabel);
  });
};

afterEach(() => {
  cleanup();
});

describe("settings appearance section", () => {
  test("renders horizontal scrollbar visibility choices", async () => {
    renderAppearanceSection(createAppearanceSettings());

    expect(screen.getByText("Appearance")).toBeDefined();
    expect(screen.getByText("Horizontal Scrollbars")).toBeDefined();
    expect(screen.getByRole("button", { name: "Horizontal Scrollbars" }).textContent).toContain(
      "System default",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Horizontal Scrollbars" }));
    });

    await screen.findByText("Show");

    expect(screen.getAllByText("System default").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Show")).toBeDefined();
    expect(screen.getByText("Hide")).toBeDefined();
    expect(
      screen.getByText(
        "System default shows horizontal scrollbars on Windows and Linux, and hides them on macOS. Choose Show or Hide to override it on every platform.",
      ),
    ).toBeDefined();
  });

  test("selects the saved visibility mode", () => {
    renderAppearanceSection(createAppearanceSettings({ horizontalScrollbarVisibility: "show" }));

    expect(screen.getByRole("button", { name: "Horizontal Scrollbars" }).textContent).toContain(
      "Show",
    );
  });

  test("disables the select while settings interactions are disabled", () => {
    renderAppearanceSection(createAppearanceSettings(), true);

    expect(
      screen.getByRole("button", { name: "Horizontal Scrollbars" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("updates the horizontal scrollbar mode without dropping unrelated appearance settings", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance, rerenderLatest } =
      renderAppearanceSectionWithUpdates(appearance);

    await changeHorizontalScrollbarVisibility("show");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("hide");
    rerenderLatest();
    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).toHaveBeenCalledTimes(3);
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "system",
    });
  });

  test("does not update when clicking the already active option", async () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance } =
      renderAppearanceSectionWithUpdates(appearance);

    await changeHorizontalScrollbarVisibility("system");

    expect(onUpdateAppearance).not.toHaveBeenCalled();
    expect(getLatestAppearance()).toEqual(appearance);
  });
});
