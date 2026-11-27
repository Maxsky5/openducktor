import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createHostConnectionStore } from "@openducktor/frontend-core/connection/host-connection-state";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import {
  HOST_RECONNECTING_MESSAGE,
  HOST_RELOAD_REQUIRED_MESSAGE,
  HostConnectionIndicator,
} from "./host-connection-indicator";

afterEach(() => {
  cleanup();
});

test("shows one connection message for each disconnected state", () => {
  const connectionState = createHostConnectionStore();
  const connection = createTestClientConnection({
    host: createTestHostConnection({ connectionState }),
  });
  const onReload = mock(() => {});
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <HostConnectionIndicator onReload={onReload} />
    </ClientConnectionProvider>,
  );
  expect(view.container.textContent).toBe("");

  act(() => connectionState.setState("reconnecting"));
  expect(view.getByRole("status").textContent).toContain(HOST_RECONNECTING_MESSAGE);
  fireEvent.click(view.getByRole("button", { name: "Reload" }));
  expect(onReload).toHaveBeenCalledTimes(1);

  act(() => connectionState.setState("reload-required"));
  expect(view.getByRole("alert").textContent).toContain(HOST_RELOAD_REQUIRED_MESSAGE);
  fireEvent.click(view.getByRole("button", { name: "Reload" }));
  expect(onReload).toHaveBeenCalledTimes(2);

  act(() => connectionState.setState("connected"));
  expect(view.container.textContent).toBe("");
});
