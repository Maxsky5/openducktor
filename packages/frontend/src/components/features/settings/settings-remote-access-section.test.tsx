import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RemoteAccessBridge,
  RemoteAccessState,
  RemoteAccessConfiguration,
} from "@openducktor/contracts";
import { QueryProvider } from "@/test-utils/query-provider";
import { RemoteAccessProvider } from "@/state/remote-access-provider";
import { SettingsRemoteAccessSection } from "./settings-remote-access-section";

const configuration: RemoteAccessConfiguration = {
  listenHost: "192.168.1.9",
  listenPort: 14328,
  publicEndpoint: "http://192.168.1.9:14328",
};
const bridge = (initial: RemoteAccessState): RemoteAccessBridge => ({
  readState: async () => initial,
  readNetworks: async () => [{ name: "en0", address: "192.168.1.9" }],
  enable: async () => ({ status: "available", configuration, connectedClients: 0 }),
  disable: async () => ({ status: "disabled", configuration: null, connectedClients: 0 }),
  subscribeState: async () => () => {},
});
const show = (operator: RemoteAccessBridge) =>
  render(
    <QueryProvider>
      <RemoteAccessProvider bridge={operator}>
        <SettingsRemoteAccessSection />
      </RemoteAccessProvider>
    </QueryProvider>,
  );

test("enables a detected network on the default port without typing it, and stops sharing", async () => {
  const operator = bridge({ status: "disabled", configuration: null, connectedClients: 0 });
  const enable = mock(operator.enable);
  const disable = mock(operator.disable);
  operator.enable = enable;
  operator.disable = disable;
  show(operator);
  await screen.findByRole("radio", { name: /192.168.1.9/ });
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 14328 }),
  );
  expect((await screen.findByLabelText<HTMLInputElement>("Host address")).value).toBe(
    configuration.publicEndpoint,
  );
  expect(screen.getByText("On")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
  const apply = screen.getByRole("button", { name: "Apply connection changes" });
  expect(apply.hasAttribute("disabled")).toBe(true);
  fireEvent.click(apply);
  expect(enable).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Disable remote control" }));
  await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
  await screen.findByText("Off");
  expect(screen.queryByLabelText("Host address")).toBeNull();
});

test("requires a choice when the computer has more than one network", async () => {
  const operator = bridge({ status: "disabled", configuration: null, connectedClients: 0 });
  operator.readNetworks = async () => [
    { name: "en0", address: "192.168.1.9" },
    { name: "vpn", address: "100.64.0.1" },
  ];
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  const network = await screen.findByRole("radio", { name: /192.168.1.9/ });
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Choose a network");
  expect(enable).not.toHaveBeenCalled();
  fireEvent.click(network);
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 14328 }),
  );
});

test.each(["65536", ""])("keeps Advanced settings and rejects invalid port %s", async (value) => {
  const manual = {
    listenHost: "0.0.0.0",
    listenPort: 14328,
    publicEndpoint: "https://machine.test/api/remote",
  };
  const operator = bridge({ status: "available", configuration: manual, connectedClients: 0 });
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  fireEvent.click(await screen.findByRole("button", { name: "Connection settings" }));
  const port = await screen.findByLabelText("Port");
  if (!(port instanceof HTMLInputElement)) throw new Error("Port must be an input.");
  const proxy = screen.getByLabelText("Public host address");
  if (!(proxy instanceof HTMLInputElement))
    throw new Error("Public host address must be an input.");
  expect(port.value).toBe("14328");
  expect(proxy.value).toBe(manual.publicEndpoint);
  fireEvent.change(port, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Apply connection changes" }));
  expect((await screen.findByRole("alert")).textContent).toContain("1 to 65535");
  expect(document.activeElement).toBe(port);
  expect(enable).not.toHaveBeenCalled();
  fireEvent.change(port, { target: { value: "14329" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply connection changes" }));
  await waitFor(() => expect(enable).toHaveBeenCalledWith({ ...manual, listenPort: 14329 }));
});

test("enables a public host address on the default port", async () => {
  const operator = bridge({ status: "disabled", configuration: null, connectedClients: 0 });
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  await screen.findByRole("radio", { name: /192.168.1.9/ });
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.change(screen.getByLabelText("Public host address"), {
    target: { value: "https://machine.test/remote" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({
      listenHost: "192.168.1.9",
      listenPort: 14328,
      publicEndpoint: "https://machine.test/remote",
    }),
  );
});

test.each([
  ["MYCOMPUTER.local", "http://MYCOMPUTER.local:51541"],
  ["fd00:0:0:0:0:0:0:2", "http://[fd00:0:0:0:0:0:0:2]:51541"],
])("keeps a direct address direct when reopening host %s", async (listenHost, publicEndpoint) => {
  show(
    bridge({
      status: "available",
      connectedClients: 0,
      configuration: { listenHost, listenPort: 51541, publicEndpoint },
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Connection settings" }));
  expect(screen.queryByLabelText("Public host address") === null).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  const proxy = screen.getByLabelText("Public host address");
  if (!(proxy instanceof HTMLInputElement))
    throw new Error("Public host address must be an input.");
  expect(proxy.value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Port").value).toBe("51541");
});

test("enables the saved network and port again while remote control is off", async () => {
  const operator = bridge({
    status: "disabled",
    connectedClients: 0,
    configuration: {
      listenHost: "100.64.0.1",
      listenPort: 51541,
      publicEndpoint: "http://100.64.0.1:51541",
    },
  });
  operator.readNetworks = async () => [
    { name: "en0", address: "192.168.1.9" },
    { name: "vpn", address: "100.64.0.1" },
  ];
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  await screen.findByRole("radio", { name: /100.64.0.1/ });
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "100.64.0.1", listenPort: 51541 }),
  );
});

test("offers another port when the saved port is in use", async () => {
  const operator = bridge({
    status: "failed",
    connectedClients: 0,
    configuration: configuration,
    failure: {
      code: "port_in_use",
      message: "Port 14328 is in use by another app.",
      nextAction: "Select Use another port, or close the app that uses this port.",
    },
  });
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Port 14328 is in use by another app.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Use another port" }));
  await waitFor(() =>
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 0 }),
  );
});

test("shows network read failures and listener failures with a next action", async () => {
  const operator = bridge({ status: "disabled", configuration: null, connectedClients: 0 });
  operator.readNetworks = async () => {
    throw new Error("Could not read networks. Check the network connection.");
  };
  show(operator);
  expect((await screen.findByRole("alert")).textContent).toContain("Could not read networks");
  operator.readNetworks = async () => [{ name: "en0", address: "192.168.1.9" }];
  operator.enable = async () => ({
    status: "failed",
    configuration: null,
    connectedClients: 0,
    failure: {
      code: "unavailable",
      message: "Could not open this network.",
      nextAction: "Check the network connection and try again.",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh networks" }));
  await screen.findByRole("radio", { name: /192.168.1.9/ });
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not open this network. Check the network connection and try again.",
  );
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
});
