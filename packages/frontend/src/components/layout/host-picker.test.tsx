import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { expect, jest, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { HostPicker } from "./host-picker";
import * as feedback from "@/components/features/remote-control/connection-flow";
import { CONNECTED_VIEW_MS } from "@/components/features/remote-control/connection-flow";

test("does not offer the local host when it is already selected", () => {
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "local" },
        localHost: "electron",
        confirm: async (endpoint: string) => endpoint,
        select: async () => {},
        disconnect: async () => {},
      }}
    />,
  );
  expect(view.getByText("Desktop app host")).toBeDefined();
  expect(view.queryByRole("button", { name: "Use desktop host" })).toBeNull();
  expect(view.queryByRole("button", { name: "Disconnect" })).toBeNull();
});

test("offers the local host from the disconnected screen", async () => {
  const select = mock(async (_endpoint: string | null) => {});
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "picker" },
        localHost: "web",
        confirm: async (endpoint: string) => endpoint,
        select,
        disconnect: async () => {},
      }}
    />,
  );
  expect(view.queryByText("Current host")).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Use web runner" }));
  });
  expect(select).toHaveBeenCalledWith(null);
});

test("connects to the current remote host again after the connected view", async () => {
  jest.useFakeTimers();
  try {
    const confirm = mock(async (endpoint: string, _code?: string) => endpoint);
    const select = mock(async (_endpoint: string | null) => {});
    const view = render(
      <HostPicker
        selection={{
          target: { kind: "remote", endpoint: "https://host.test" },
          localHost: null,
          confirm,
          select,
          disconnect: async () => {},
        }}
      />,
    );
    fireEvent.change(view.getByLabelText("Host address"), {
      target: { value: "https://host.test" },
    });
    await act(async () => {
      fireEvent.submit(view.getByRole("button", { name: "Switch host" }).closest("form")!);
    });
    expect(confirm).toHaveBeenCalledWith("https://host.test", undefined);
    expect(view.getByRole("status").textContent).toContain("Connected");
    expect(select).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(CONNECTED_VIEW_MS));
    expect(select).toHaveBeenCalledWith("https://host.test");
  } finally {
    jest.useRealTimers();
  }
});

test("disconnect locks the form and reports its own failure", async () => {
  const gate = Promise.withResolvers<void>();
  const disconnect = mock(() => gate.promise);
  const onCancel = mock(() => {});
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: "web",
        confirm: async (endpoint: string) => endpoint,
        select: async () => {},
        disconnect,
      }}
      onCancel={onCancel}
    />,
  );
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Disconnect" }));
  });
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Disconnecting…" })).toBeDefined();
  // The fields keep their look while the request runs, so the form does not flicker.
  const input = view.getByLabelText("Host address");
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected a host address input.");
  expect(input.readOnly).toBe(true);
  await act(async () => {
    gate.reject(new Error("Could not release the host connection. Try again."));
  });
  expect(view.getByRole("alert").textContent).toContain("Could not release the host connection.");
  expect(input.getAttribute("aria-invalid")).toBe("false");
  expect(input.readOnly).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("keeps Cancel left and connection actions right when the footer stacks", () => {
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: "web",
        confirm: async (endpoint: string) => endpoint,
        select: async () => {},
        disconnect: async () => {},
      }}
      onCancel={() => {}}
    />,
  );
  const cancel = view.getByRole("button", { name: "Cancel" });
  const footer = cancel.closest('[data-slot="dialog-footer"]');
  expect(footer).not.toBeNull();
  expect(footer?.className).toContain("justify-between");
  expect(footer?.className).toContain("sm:flex-row");
  expect(footer?.className).toContain("items-end");
  expect(footer?.className).not.toContain("flex-wrap-reverse");
  expect(cancel.className).toContain("self-start");
  expect(cancel.className).toContain("sm:self-auto");
  const actions = footer?.lastElementChild;
  expect(actions?.className).toContain("ml-auto");
  expect(actions?.className).toContain("justify-end");
});

test("the picker reports a failed check, keeps the host, and permits a local connection", async () => {
  const select = mock(async (_endpoint: string | null) => {});
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "remote", endpoint: "https://current.test" },
        localHost: "web",
        confirm: async () => {
          throw new Error("Host is not reachable.");
        },
        select,
        disconnect: async () => {},
      }}
    />,
  );
  fireEvent.change(view.getByLabelText("Host address"), {
    target: { value: "https://host.test" },
  });
  fireEvent.submit(view.getByRole("button", { name: "Switch host" }).closest("form")!);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Host is not reachable."),
  );
  expect(view.getByLabelText("Host address").getAttribute("aria-invalid")).toBe("true");
  expect(select).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Use web runner" }));
  });
  expect(select).toHaveBeenLastCalledWith(null);
});

test("pairs with the address and code in one step and keeps a refused code with its field", async () => {
  jest.useFakeTimers();
  try {
    const confirm = mock(async (endpoint: string, code?: string) => {
      if (code === "111111")
        throw new RemoteConnectionError({
          code: "pairing_refused",
          message: "The pairing code is wrong, expired, or already used.",
          nextAction: "On the host, select Add device in Remote control, then enter the new code.",
        });
      return endpoint;
    });
    const select = mock(async (_endpoint: string | null) => {});
    const view = render(
      <HostPicker
        selection={{
          target: { kind: "picker" },
          localHost: null,
          confirm,
          select,
          disconnect: async () => {},
        }}
      />,
    );
    fireEvent.change(view.getByLabelText("Host address"), {
      target: { value: "http://192.168.1.9:14328" },
    });
    const code = view.getByLabelText("Pairing code");
    fireEvent.change(code, { target: { value: "12" } });
    await act(async () => {
      fireEvent.submit(view.getByRole("button", { name: "Connect to host" }).closest("form")!);
    });
    expect(view.getByRole("alert").textContent).toContain("Enter all six digits");
    expect(confirm).not.toHaveBeenCalled();
    // The sixth digit connects without a click.
    fireEvent.change(code, { target: { value: "111111" } });
    await act(async () => jest.advanceTimersByTime(50));
    expect(confirm).toHaveBeenCalledWith("http://192.168.1.9:14328", "111111");
    const refusal = view.getByRole("alert");
    expect(refusal.textContent).toContain("The pairing code is wrong");
    expect(refusal.textContent).toContain("select Add device");
    expect(code.getAttribute("aria-describedby")).toContain(refusal.id);
    // A changed digit of a full code waits for Connect.
    fireEvent.change(code, { target: { value: "012345" } });
    await act(async () => jest.advanceTimersByTime(50));
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.submit(view.getByRole("button", { name: "Connect to host" }).closest("form")!);
    });
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByRole("status").textContent).toContain("Connected");
    await act(async () => jest.advanceTimersByTime(CONNECTED_VIEW_MS));
    expect(select).toHaveBeenCalledWith("http://192.168.1.9:14328");
  } finally {
    jest.useRealTimers();
  }
});

test("a closed picker does not switch hosts when a pending check succeeds", async () => {
  // The Connected view waits one second. This test checks the order, not the time.
  const connectedView = spyOn(feedback, "waitForConnectedView").mockResolvedValue();
  const check = Promise.withResolvers<string>();
  const select = mock(async (_endpoint: string | null) => {});
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "picker" },
        localHost: null,
        confirm: () => check.promise,
        select,
        disconnect: async () => {},
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(view.getByLabelText("Host address"), {
    target: { value: "http://192.168.1.9:14328" },
  });
  fireEvent.change(view.getByLabelText("Pairing code"), { target: { value: "123456" } });
  // Cancel closes the dialog, which unmounts the picker while the check runs.
  view.unmount();
  await act(async () => check.resolve("http://192.168.1.9:14328"));
  expect(select).not.toHaveBeenCalled();
  connectedView.mockRestore();
});
