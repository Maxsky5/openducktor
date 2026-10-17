import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoteAddress } from "./remote-address";

const endpoint = "http://192.168.1.9:51541";

test("copies the host address and confirms success", async () => {
  const copy = mock(async (_value: string) => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  try {
    render(<RemoteAddress endpoint={endpoint} connectedClients={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(endpoint));
    await screen.findByRole("button", { name: "Copied" });
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("opens a QR dialog for the host address", async () => {
  render(<RemoteAddress endpoint={endpoint} connectedClients={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
  const qr = await screen.findByRole("img", { name: `Host address QR code: ${endpoint}` });
  expect(qr.closest('[role="dialog"]')).not.toBeNull();
  expect(qr.getAttribute("src")).toStartWith("data:image/png;base64,");
});
