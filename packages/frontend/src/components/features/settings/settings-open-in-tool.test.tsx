import { afterEach, describe, expect, test } from "bun:test";
import type { SystemSettings } from "@openducktor/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/host";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SETTINGS_SECTIONS } from "./settings-modal-constants";

enableReactActEnvironment();
const originalList = host.systemListOpenInTools;
afterEach(() => {
  cleanup();
  host.systemListOpenInTools = originalList;
});

function Harness({
  initial = {},
  disabled = false,
}: {
  initial?: SystemSettings;
  disabled?: boolean;
}) {
  const [system, setSystem] = useState(initial);
  return (
    <QueryProvider useIsolatedClient>
      <SettingsAppearanceSection
        appearance={{ horizontalScrollbarVisibility: "system" }}
        onUpdateAppearance={() => {}}
        system={system}
        disabled={disabled}
        onUpdateSystem={setSystem}
      />
      <output>{JSON.stringify(system)}</output>
    </QueryProvider>
  );
}

describe("Open In settings", () => {
  test("lists available tools and sets a preference without a clear action", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
    expect(SETTINGS_SECTIONS.some(({ label }) => label === "System")).toBe(false);
    const trigger = screen.getByRole<HTMLButtonElement>("button", {
      name: "Preferred Open In tool",
    });
    await waitFor(() => expect(trigger.disabled).toBe(false));
    expect(trigger.textContent).toContain("Finder");
    expect(
      trigger.querySelector('[data-testid="agent-studio-git-open-in-icon-finder"]'),
    ).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("{}");
    await act(async () => fireEvent.click(trigger));
    expect(screen.queryByText("Cursor")).toBeNull();
    expect(screen.queryByText("First available tool")).toBeNull();
    expect(screen.getByTestId("agent-studio-git-open-in-icon-zed")).toBeDefined();
    await act(async () => fireEvent.click(await screen.findByText("Zed")));
    expect(screen.getByRole("status").textContent).toBe('{"preferredOpenInToolId":"zed"}');
    expect(screen.queryByRole("button", { name: "Clear preference" }) === null).toBe(true);
  });

  test("can save the displayed default as an explicit preference", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    render(<Harness />);
    const trigger = screen.getByRole<HTMLButtonElement>("button", {
      name: "Preferred Open In tool",
    });
    await waitFor(() => expect(trigger.disabled).toBe(false));
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Finder" })));
    expect(screen.getByRole("status").textContent).toBe('{"preferredOpenInToolId":"finder"}');
  });

  test("disables the selector when no apps are available without changing the preference", async () => {
    host.systemListOpenInTools = async () => [];
    render(<Harness />);
    await waitFor(() =>
      expect(screen.queryByText("Looking for supported apps…") === null).toBe(true),
    );
    const trigger = screen.getByRole<HTMLButtonElement>("button", {
      name: "Preferred Open In tool",
    });
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toContain("No supported apps found");
    expect(screen.getByRole("status").textContent).toBe("{}");
  });

  test("shows the default when the saved tool is unavailable without changing the preference", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }];
    render(<Harness initial={{ preferredOpenInToolId: "zed" }} />);
    await screen.findByText("Zed is unavailable. Open In will use Finder.");
    expect(screen.getByRole("button", { name: "Preferred Open In tool" }).textContent).toContain(
      "Finder",
    );
    expect(screen.getByRole("status").textContent).toBe('{"preferredOpenInToolId":"zed"}');
  });

  test("shows discovery errors and retries while preserving the preference", async () => {
    let calls = 0;
    host.systemListOpenInTools = async () => {
      if (++calls === 1) throw new Error("discovery failed");
      return [{ toolId: "zed" }];
    };
    render(<Harness initial={{ preferredOpenInToolId: "zed" }} />);
    await screen.findByText(
      "Failed to load supported apps: discovery failed",
      {},
      { timeout: 700 },
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Preferred Open In tool" }).disabled,
    ).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    await waitFor(
      () =>
        expect(screen.queryByText("Failed to load supported apps: discovery failed") === null).toBe(
          true,
        ),
      { timeout: 700 },
    );
    expect(screen.getByRole("status").textContent).toBe('{"preferredOpenInToolId":"zed"}');
  });

  test("disables selection during save", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "zed" }];
    render(<Harness initial={{ preferredOpenInToolId: "zed" }} disabled />);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Preferred Open In tool" }).disabled,
    ).toBe(true);
  });
});
