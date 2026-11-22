import { expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { type PortItem, PortsPopover } from "./ports-popover";

const items: PortItem[] = [
  { key: "a", port: 5173, detail: "vite", url: "http://127.0.0.1:5173/", title: "Open :5173" },
  { key: "b", port: 5432, detail: "postgres", url: null, title: ":5432. Not a web server." },
  { key: "c", port: 8080, detail: "api", url: "http://127.0.0.1:8080/", title: "Open :8080" },
];

const openList = async () => {
  const onOpenUrl = mock((_url: string) => {});
  const view = render(
    <PortsPopover items={items} listLabel="Ports of web" onOpenUrl={onOpenUrl} />,
  );
  fireEvent.click(view.getByRole("button", { name: "3 ports running" }));
  const list = await view.findByRole("dialog", { name: "Ports of web" });
  return { view, list, onOpenUrl };
};

test("moves between the web ports with the arrow keys", async () => {
  const { view, list } = await openList();
  const first = view.getByRole("button", { name: "Open :5173" });
  const last = view.getByRole("button", { name: "Open :8080" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "ArrowDown" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowUp" });
  expect(document.activeElement).toBe(last);
  // A port without a web page is text.
  expect(list.textContent).toContain(":5432");
  expect(view.queryByRole("button", { name: /5432/ })).toBeNull();
});

test("opens a port and closes the list", async () => {
  const { view, onOpenUrl } = await openList();
  fireEvent.click(view.getByRole("button", { name: "Open :8080" }));
  expect(onOpenUrl).toHaveBeenCalledWith("http://127.0.0.1:8080/");
  await waitFor(() => expect(view.queryByRole("dialog", { name: "Ports of web" })).toBeNull());
});

test("shows nothing without a port", () => {
  const view = render(<PortsPopover items={[]} listLabel="Ports of web" onOpenUrl={() => {}} />);
  expect(view.container.childElementCount).toBe(0);
});
