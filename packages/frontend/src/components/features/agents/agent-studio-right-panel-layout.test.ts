import { describe, expect, test } from "bun:test";
import { shouldUseExpandedDevServerLayout } from "./agent-studio-right-panel-layout";

describe("shouldUseExpandedDevServerLayout", () => {
  test("keeps the compact layout mounted while dev-server Settings is open", () => {
    expect(
      shouldUseExpandedDevServerLayout({
        devServerIsExpanded: true,
        devServerSettingsIsOpen: true,
      }),
    ).toBe(false);
  });

  test("uses the runtime-requested layout when dev-server Settings is closed", () => {
    expect(
      shouldUseExpandedDevServerLayout({
        devServerIsExpanded: true,
        devServerSettingsIsOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldUseExpandedDevServerLayout({
        devServerIsExpanded: false,
        devServerSettingsIsOpen: false,
      }),
    ).toBe(false);
  });
});
