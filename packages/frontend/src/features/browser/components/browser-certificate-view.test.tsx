import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BrowserCertificateView } from "./browser-certificate-view";

describe("BrowserCertificateView", () => {
  test("shows the error and the host and offers Go back and Proceed to this site", async () => {
    const onBack = mock(async () => {});
    const onProceed = mock(async () => {});
    render(
      <BrowserCertificateView
        prompt={{
          promptId: "prompt-1",
          kind: "certificate",
          host: "dev.example.test",
          url: "https://dev.example.test/",
          error: "net::ERR_CERT_AUTHORITY_INVALID",
        }}
        onBack={onBack}
        onProceed={onProceed}
      />,
    );

    expect(screen.getByRole("heading").textContent).toBe("This connection is not private");
    expect(screen.getByText("net::ERR_CERT_AUTHORITY_INVALID")).toBeTruthy();
    expect(screen.getAllByText(/dev\.example\.test/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Proceed to this site" }));
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("goes back and shows a rejected answer", async () => {
    const onBack = mock(async () => {
      throw new Error("The tab is closed.");
    });
    render(
      <BrowserCertificateView
        prompt={{
          promptId: "prompt-1",
          kind: "certificate",
          host: "dev.example.test",
          url: "https://dev.example.test/",
          error: "net::ERR_CERT_DATE_INVALID",
        }}
        onBack={onBack}
        onProceed={async () => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    });

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("The tab is closed.");
  });
});
