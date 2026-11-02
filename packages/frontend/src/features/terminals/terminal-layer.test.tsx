import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalStatusMessages } from "./terminal-layer";

test("offers Retry and Dismiss for a discovery failure and Dismiss for a transport failure", () => {
  const markup = renderToStaticMarkup(
    <TerminalStatusMessages
      terminals={{
        discoveryNotice: "The host did not answer.",
        onDismissDiscoveryError: () => {},
        transportNotice: "Socket closed.",
        onDismissTransportError: () => {},
        isLoading: false,
        onRetryDiscovery: () => {},
      }}
    />,
  );
  expect(markup).toContain("Retry terminal discovery");
  expect(markup).toContain('aria-label="Dismiss terminal discovery error"');
  expect(markup).toContain('aria-label="Dismiss terminal transport error"');
});
