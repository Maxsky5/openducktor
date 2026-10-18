import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { configureShellBridge, getShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { SessionPageHeader } from "./session-page-header";

for (const remote of [false, true]) {
  test(`session headers only mount Open In for a local host: remote=${remote}`, () => {
    const previousBridge = getShellBridge();
    configureShellBridge(
      createShellBridgeFixture({
        bridge: remote
          ? {
              remoteConnection: {
                readState: () => ({ status: "connected", generation: 1 }),
                subscribeState: () => () => {},
                retry: async () => {},
              },
            }
          : {},
      }),
    );
    const OpenIn = mock(() => <button type="button">Open In</button>);
    try {
      const html = renderToStaticMarkup(
        <SessionPageHeader
          title="Session"
          actions={<button type="button">Session actions</button>}
          viewControls={<button type="button">Toggle terminal</button>}
          openIn={<OpenIn />}
        />,
      );
      expect(html.includes("Open In")).toBe(!remote);
      expect(OpenIn).toHaveBeenCalledTimes(remote ? 0 : 1);
      expect(html).toContain("Session actions");
      expect(html).toContain("Toggle terminal");
    } finally {
      configureShellBridge(previousBridge);
    }
  });
}
