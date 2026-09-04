import { afterEach, describe, expect, test } from "bun:test";
import type { SystemSettings } from "@openducktor/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { host } from "@/state/operations/host";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { SettingsSystemSection } from "./settings-system-section";

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
      <SettingsSystemSection system={system} disabled={disabled} onUpdateSystem={setSystem} />
      <output>{JSON.stringify(system)}</output>
    </QueryProvider>
  );
}

describe("System settings", () => {
  test("lists available tools, sets a preference, and clears it without null", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }, { toolId: "zed" }];
    render(<Harness />);
    const trigger = screen.getByRole<HTMLButtonElement>("button", {
      name: "Preferred Open In tool",
    });
    await waitFor(() => expect(trigger.disabled).toBe(false));
    expect(trigger.textContent).toContain("First available tool");
    await act(async () => fireEvent.click(trigger));
    expect(screen.queryByText("Cursor")).toBeNull();
    await act(async () => fireEvent.click(await screen.findByText("Zed")));
    expect(screen.getByRole("status").textContent).toBe('{"preferredOpenInToolId":"zed"}');
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Clear preference" })),
    );
    expect(screen.getByRole("status").textContent).toBe("{}");
    expect(trigger.textContent).toContain("First available tool");
  });

  test("shows an unavailable saved tool and allows clearing it", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "finder" }];
    render(<Harness initial={{ preferredOpenInToolId: "zed" }} />);
    await screen.findByText("Zed is unavailable. Open In will use the first available tool.");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Clear preference" })),
    );
    expect(screen.getByRole("status").textContent).toBe("{}");
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

  test("disables selection and clearing during save", async () => {
    host.systemListOpenInTools = async () => [{ toolId: "zed" }];
    render(<Harness initial={{ preferredOpenInToolId: "zed" }} disabled />);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Preferred Open In tool" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Clear preference" }).disabled,
    ).toBe(true);
  });
});
