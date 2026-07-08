import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AppearanceSettings } from "@openducktor/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsAppearanceSection } from "./settings-appearance-section";

const createAppearanceSettings = (
  overrides: Partial<AppearanceSettings> = {},
): AppearanceSettings => ({
  horizontalScrollbarVisibility: "system",
  ...overrides,
});

const renderAppearanceSection = (appearance: AppearanceSettings, disabled = false): void => {
  render(
    <SettingsAppearanceSection
      appearance={appearance}
      disabled={disabled}
      onUpdateAppearance={() => appearance}
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

const clickHorizontalScrollbarOption = (label: string): void => {
  fireEvent.click(
    within(screen.getByRole("group", { name: "Horizontal Scrollbars" })).getByRole("button", {
      name: label,
    }),
  );
};

afterEach(() => {
  cleanup();
});

describe("settings appearance section", () => {
  test("renders horizontal scrollbar visibility choices", () => {
    renderAppearanceSection(createAppearanceSettings());

    expect(screen.getByText("Appearance")).toBeDefined();
    expect(screen.getByText("Horizontal Scrollbars")).toBeDefined();
    expect(
      within(screen.getByRole("group", { name: "Horizontal Scrollbars" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["System default", "Show", "Hide"]);
  });

  test("marks the saved visibility mode as active", () => {
    renderAppearanceSection(createAppearanceSettings({ horizontalScrollbarVisibility: "show" }));

    expect(
      within(screen.getByRole("group", { name: "Horizontal Scrollbars" }))
        .getByRole("button", { name: "Show" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("disables every option while settings interactions are disabled", () => {
    renderAppearanceSection(createAppearanceSettings(), true);

    const options = within(
      screen.getByRole("group", { name: "Horizontal Scrollbars" }),
    ).getAllByRole("button");
    expect(options).toHaveLength(3);
    expect(options.every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  test("updates the horizontal scrollbar mode without dropping unrelated appearance settings", () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance, rerenderLatest } =
      renderAppearanceSectionWithUpdates(appearance);

    clickHorizontalScrollbarOption("Show");
    rerenderLatest();
    clickHorizontalScrollbarOption("Hide");
    rerenderLatest();
    clickHorizontalScrollbarOption("System default");

    expect(onUpdateAppearance).toHaveBeenCalledTimes(3);
    expect(getLatestAppearance()).toEqual({
      horizontalScrollbarVisibility: "system",
    });
  });

  test("does not update when clicking the already active option", () => {
    const appearance = createAppearanceSettings();
    const { getLatestAppearance, onUpdateAppearance } =
      renderAppearanceSectionWithUpdates(appearance);

    clickHorizontalScrollbarOption("System default");

    expect(onUpdateAppearance).not.toHaveBeenCalled();
    expect(getLatestAppearance()).toEqual(appearance);
  });
});
