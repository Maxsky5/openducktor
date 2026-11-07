import { describe, expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import type { ElectronBrowserBridge } from "@/lib/shell-bridge";
import { createBrowserFocusRegistry } from "./browser-focus-registry";
import { ElectronPageSurface } from "./electron-page-surface";
import type { BrowserSurfacePlacement } from "./use-browser-surface-placement";

const TAB_ID = "00000000-0000-4000-8000-000000000001";
const BOX = { left: 12, top: 24, width: 640, height: 480 };

const createBridge = () => {
  const setSurface = mock(async () => {});
  const capturePage = mock(async () => "data:image/png;base64,AAAA");
  const focusPage = mock(async () => {});
  return {
    setSurface,
    capturePage,
    focusPage,
    bridge: {
      surface: "electron",
      connect: async () => ({ send: async () => {}, close: () => {} }),
      setSurface,
      capturePage,
      focusPage,
      pickFiles: async () => [],
    } satisfies ElectronBrowserBridge,
  };
};

const placement = (visible: boolean): BrowserSurfacePlacement => ({ visible, ...BOX });

const renderSurface = (
  bridge: ElectronBrowserBridge,
  current: BrowserSurfacePlacement,
  occluded: boolean,
) => {
  const focus = createBrowserFocusRegistry();
  const result = render(
    <ElectronPageSurface
      bridge={bridge}
      focus={focus}
      occluded={occluded}
      placement={current}
      tabId={TAB_ID}
    />,
  );
  return {
    ...result,
    rerenderSurface: (next: BrowserSurfacePlacement, nextOccluded: boolean) =>
      result.rerender(
        <ElectronPageSurface
          bridge={bridge}
          focus={focus}
          occluded={nextOccluded}
          placement={next}
          tabId={TAB_ID}
        />,
      ),
  };
};

describe("ElectronPageSurface", () => {
  test("places a shown page in its window", async () => {
    const { bridge, setSurface, capturePage } = createBridge();
    renderSurface(bridge, placement(true), false);

    await waitFor(() =>
      expect(setSurface).toHaveBeenCalledWith({
        tabId: TAB_ID,
        visible: true,
        bounds: { x: 12, y: 24, width: 640, height: 480 },
      }),
    );
    expect(capturePage).not.toHaveBeenCalled();
  });

  test("turns a page into its snapshot under a host overlay, then shows it again", async () => {
    const { bridge, setSurface, capturePage } = createBridge();
    const { queryByTestId, rerenderSurface } = renderSurface(bridge, placement(true), true);

    await waitFor(() =>
      expect(setSurface).toHaveBeenLastCalledWith({ tabId: TAB_ID, visible: false }),
    );
    expect(capturePage).toHaveBeenCalledTimes(1);
    expect(queryByTestId("browser-page-snapshot")).not.toBeNull();

    rerenderSurface(placement(true), false);
    await waitFor(() =>
      expect(setSurface).toHaveBeenLastCalledWith({
        tabId: TAB_ID,
        visible: true,
        bounds: { x: 12, y: 24, width: 640, height: 480 },
      }),
    );
    expect(queryByTestId("browser-page-snapshot")).toBeNull();
  });

  test("keeps a page out of every window while no panel shows it", async () => {
    const { bridge, setSurface } = createBridge();
    renderSurface(bridge, placement(false), false);

    await waitFor(() =>
      expect(setSurface).toHaveBeenLastCalledWith({ tabId: TAB_ID, visible: false }),
    );
  });
});
