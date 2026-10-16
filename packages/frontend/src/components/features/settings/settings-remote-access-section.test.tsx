import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RemoteAccessBridge,
  RemoteAccessState,
  RemoteAccessConfiguration,
} from "@openducktor/contracts";
import { QueryProvider } from "@/lib/query-provider";
import { SettingsRemoteAccessSection } from "./settings-remote-access-section";

const configuration: RemoteAccessConfiguration = {
  listenHost: "192.168.1.9",
  listenPort: 0,
  publicEndpoint: "http://192.168.1.9:51541",
};
const bridge = (initial: RemoteAccessState): RemoteAccessBridge => ({
  readState: async () => initial,
  readNetworks: async () => [{ name: "en0", address: "192.168.1.9" }],
  enable: async () => ({ status: "available", configuration }),
  disable: async () => ({ status: "disabled", configuration: null }),
  subscribeState: async () => () => {},
});
const show = (operator: RemoteAccessBridge) =>
  render(
    <QueryProvider useIsolatedClient>
      <SettingsRemoteAccessSection bridge={operator} />
    </QueryProvider>,
  );

test("enables a detected network without typing a port or URL and stops sharing", async () => {
  const operator = bridge({ status: "disabled", configuration: null });
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
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 0 }),
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
  const operator = bridge({ status: "disabled", configuration: null });
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
    expect(enable).toHaveBeenCalledWith({ listenHost: "192.168.1.9", listenPort: 0 }),
  );
});

test.each(["65536", ""])("keeps Advanced settings and rejects invalid port %s", async (value) => {
  const manual = {
    listenHost: "0.0.0.0",
    listenPort: 14328,
    publicEndpoint: "https://machine.test/api/remote",
  };
  const operator = bridge({ status: "available", configuration: manual });
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  fireEvent.click(await screen.findByRole("button", { name: "Connection settings" }));
  const port = await screen.findByLabelText("Fixed port");
  if (!(port instanceof HTMLInputElement)) throw new Error("Fixed port must be an input.");
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

test("requires a fixed port for a proxy so its forwarding target stays known", async () => {
  const operator = bridge({ status: "disabled", configuration: null });
  const enable = mock(operator.enable);
  operator.enable = enable;
  show(operator);
  await screen.findByRole("radio", { name: /192.168.1.9/ });
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.change(screen.getByLabelText("Public host address"), {
    target: { value: "https://machine.test/remote" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enable remote control" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Turn off automatic port selection.",
  );
  expect(enable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "Choose a port automatically" }));
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
])("keeps automatic setup when reopening host %s", async (listenHost, publicEndpoint) => {
  show(
    bridge({ status: "available", configuration: { listenHost, listenPort: 0, publicEndpoint } }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Connection settings" }));
  expect(screen.queryByLabelText("Public host address") === null).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  const proxy = screen.getByLabelText("Public host address");
  if (!(proxy instanceof HTMLInputElement))
    throw new Error("Public host address must be an input.");
  expect(proxy.value).toBe("");
  expect(
    screen
      .getByRole("switch", { name: "Choose a port automatically" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

test("shows network read failures and listener failures with a next action", async () => {
  const operator = bridge({ status: "disabled", configuration: null });
  operator.readNetworks = async () => {
    throw new Error("Could not read networks. Check the network connection.");
  };
  show(operator);
  expect((await screen.findByRole("alert")).textContent).toContain("Could not read networks");
  operator.readNetworks = async () => [{ name: "en0", address: "192.168.1.9" }];
  operator.enable = async () => ({
    status: "failed",
    configuration: null,
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
