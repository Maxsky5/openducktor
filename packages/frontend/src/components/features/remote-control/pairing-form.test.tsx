import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import * as feedback from "./connection-flow";
import { PairingForm } from "./pairing-form";

let connectedView: ReturnType<typeof spyOn>;
beforeEach(() => {
  // The Connected view waits one second. These tests check the order, not the time.
  connectedView = spyOn(feedback, "waitForConnectedView").mockResolvedValue();
});
afterEach(() => connectedView.mockRestore());

const refused = new RemoteConnectionError({
  code: "pairing_refused",
  message: "The pairing code is wrong, expired, or already used.",
  nextAction: "On the host, select Add device in Remote control, then enter the new code.",
});

test("submits the sixth digit, keeps a refused code in an alert, then shows Connected and reconnects", async () => {
  const pair = mock(async (code: string) => {
    if (code === "012345") throw refused;
  });
  const reconnect = mock(async () => {});
  render(
    <PairingForm
      endpoint="http://host:14328"
      failure={{
        code: "authorization_required",
        message: "Authorization required.",
        nextAction: "Enter a code.",
      }}
      pair={pair}
      reconnect={reconnect}
      onCancel={() => {}}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Pairing code");
  // A request for a code is the normal start, not an error.
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(input, { target: { value: "012" } });
  expect(pair).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "012345" } });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The pairing code is wrong");
  expect(alert.textContent).toContain("select Add device");
  expect(input.value).toBe("012345");
  expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "654321" } });
  await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status").textContent).toContain("Connected");
  expect(connectedView).toHaveBeenCalledTimes(1);
  expect(pair.mock.calls.map(([code]) => code)).toEqual(["012345", "654321"]);
});

test("explains refused saved access, and Cancel ignores a pending pairing", async () => {
  const attempt = Promise.withResolvers<void>();
  const reconnect = mock(async () => {});
  const cancel = mock(() => {});
  render(
    <PairingForm
      endpoint="https://host"
      failure={{
        code: "authorization_rejected",
        message: "Saved access is invalid or revoked.",
        nextAction: "Enter a new code.",
      }}
      pair={() => attempt.promise}
      reconnect={reconnect}
      onCancel={cancel}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("This device needs a new pairing code.");
  fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "123456" } });
  expect(screen.getByRole("button", { name: "Connecting..." })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => attempt.resolve());
  expect(reconnect).not.toHaveBeenCalled();
});
