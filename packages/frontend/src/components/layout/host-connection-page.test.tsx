import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { HostConnectionPage } from "./host-connection-page";

afterEach(() => {
  localStorage.removeItem("openducktor:client-theme");
  document.documentElement.classList.remove("light", "dark");
});

test("the connection page changes and restores its theme without a host provider", async () => {
  const page = () => (
    <HostConnectionPage title="Connect to your host" description="Choose your host computer.">
      <input aria-label="Host address" />
    </HostConnectionPage>
  );
  const view = render(page());
  fireEvent.click(view.getByRole("button", { name: /^Theme:/ }));
  fireEvent.click(await view.findByRole("option", { name: "Light" }));
  await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
  fireEvent.click(view.getByRole("button", { name: "Theme: Light" }));
  fireEvent.click(await view.findByRole("option", { name: "Dark" }));
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  view.unmount();
  const reopened = render(page());
  expect(reopened.getByRole("button", { name: "Theme: Dark" })).toBeDefined();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(reopened.getByLabelText("Host address")).toBeDefined();
});
