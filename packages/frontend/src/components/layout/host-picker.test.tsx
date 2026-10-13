import { expect, mock, test } from "bun:test";
import { act } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { HostPicker } from "./host-picker";

test("does not offer the local host when it is already selected", () => {
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "local" },
        localHost: "electron",
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
        select,
        disconnect: async () => {},
      }}
    />,
  );
  expect(view.queryByText("Selected host")).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Use web runner" }));
  });
  expect(select).toHaveBeenCalledWith(null);
});

test("does not switch to the current remote host, including an equivalent URL", async () => {
  const select = mock(async (_endpoint: string | null) => {});
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "remote", endpoint: "https://host.test" },
        localHost: null,
        select,
        disconnect: async () => {},
      }}
    />,
  );
  const input = view.getByLabelText("New host address");
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected a host address input.");
  expect(input.value).toBe("");
  expect(view.getAllByText("https://host.test")).toHaveLength(1);
  fireEvent.change(input, { target: { value: "https://HOST.test/" } });
  await act(async () => {
    fireEvent.submit(view.getByRole("button", { name: "Switch host" }).closest("form")!);
  });
  expect(view.getByRole("alert").textContent).toContain("This host is already selected.");
  expect(select).not.toHaveBeenCalled();
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
  const fields = view.getByRole("group", { name: "" });
  if (!(fields instanceof HTMLFieldSetElement)) throw new Error("Expected a disabled fieldset.");
  expect(fields.disabled).toBe(true);
  const input = view.getByLabelText("New host address");
  await act(async () => {
    gate.reject(new Error("Could not release the host connection. Try again."));
  });
  expect(view.getByRole("alert").textContent).toContain("Could not release the host connection.");
  expect(input.getAttribute("aria-invalid")).toBe("false");
  expect(fields.disabled).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("the picker connects the entered host, reports failure, and permits a local connection", async () => {
  const select = mock(async (endpoint: string | null) => {
    if (endpoint !== null) throw new Error("Host is not reachable.");
  });
  const view = render(
    <HostPicker
      selection={{
        target: { kind: "remote", endpoint: "https://current.test" },
        localHost: "web",
        select,
        disconnect: async () => {},
      }}
    />,
  );
  fireEvent.change(view.getByLabelText("New host address"), {
    target: { value: "https://host.test" },
  });
  fireEvent.submit(view.getByRole("button", { name: "Switch host" }).closest("form")!);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Host is not reachable."),
  );
  expect(select).toHaveBeenCalledWith("https://host.test");
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Use web runner" }));
  });
  expect(select).toHaveBeenLastCalledWith(null);
});
