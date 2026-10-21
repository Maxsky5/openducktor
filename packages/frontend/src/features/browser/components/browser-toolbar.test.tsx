import { describe, expect, mock, test } from "bun:test";
import type { BrowserNavigation, BrowserTabSummary } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type BrowserPageTools, BrowserToolbar, type BrowserToolbarProps } from "./browser-toolbar";
import { createBrowserTabSummaryFixture } from "@/test-utils/session-panel-fixtures";

const pageTools = (overrides: Partial<BrowserPageTools> = {}): BrowserPageTools => ({
  supportsDevTools: false,
  pickerActive: false,
  annotationCount: 0,
  annotationsContent: <p>Annotation list</p>,
  siteMenuContent: <p>Site menu</p>,
  downloadsContent: null,
  onTogglePicker: mock(() => {}),
  onSetShared: mock(async (_shared: boolean) => {}),
  devToolsOpen: false,
  onToggleDevTools: mock(() => {}),
  ...overrides,
});

const renderToolbar = (
  overrides: Partial<BrowserToolbarProps> = {},
  toolOverrides: Partial<BrowserPageTools> = {},
) => {
  const tab = overrides.tab ?? createBrowserTabSummaryFixture();
  const tools = pageTools(toolOverrides);
  const props: BrowserToolbarProps = {
    tab,
    addressFocusRequest: 0,
    onNavigate: mock(async (_navigation: BrowserNavigation) => {}),
    onFocusPage: null,
    onAddressLoad: mock(() => {}),
    tools,
    ...overrides,
  };
  const view = render(<BrowserToolbar {...props} />);
  const rerenderTab = (tab: BrowserTabSummary): void => {
    view.rerender(<BrowserToolbar {...props} tab={tab} />);
  };
  const rerenderTools = (changes: Partial<BrowserPageTools>): void => {
    view.rerender(<BrowserToolbar {...props} tools={{ ...tools, ...changes }} />);
  };
  return { props, tools, view, rerenderTab, rerenderTools };
};

const getButton = (name: string): HTMLButtonElement => {
  const button = screen.getByRole("button", { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected the ${name} button`);
  return button;
};

const getAddress = (): HTMLInputElement => {
  const input = screen.getByRole("textbox", { name: "Address" });
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected the address input");
  return input;
};

const typeAddress = (text: string): void => {
  fireEvent.change(getAddress(), { target: { value: text } });
};

const pressKey = (key: string): void => {
  fireEvent.keyDown(getAddress(), { key });
};

describe("BrowserToolbar", () => {
  test("enables back and forward only with history and sends each navigation", () => {
    const { props, rerenderTab } = renderToolbar();
    expect(getButton("Back").disabled).toBe(true);
    expect(getButton("Forward").disabled).toBe(true);

    rerenderTab(createBrowserTabSummaryFixture({ canGoBack: true, canGoForward: true }));
    fireEvent.click(getButton("Back"));
    fireEvent.click(getButton("Forward"));
    fireEvent.click(getButton("Reload"));

    expect(props.onNavigate).toHaveBeenCalledTimes(3);
    expect(props.onNavigate).toHaveBeenNthCalledWith(1, { kind: "back" });
    expect(props.onNavigate).toHaveBeenNthCalledWith(2, { kind: "forward" });
    expect(props.onNavigate).toHaveBeenNthCalledWith(3, { kind: "reload" });
  });

  test("replaces reload with stop while the page loads", () => {
    const { props } = renderToolbar({ tab: createBrowserTabSummaryFixture({ loading: true }) });
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();

    fireEvent.click(getButton("Stop"));

    expect(props.onNavigate).toHaveBeenCalledWith({ kind: "stop" });
  });

  test("shows the page address without its scheme, and the full URL while it has the focus", () => {
    const { rerenderTab } = renderToolbar();
    expect(getAddress().value).toBe("localhost:3000");
    expect(getAddress().title).toBe("http://localhost:3000/");

    act(() => getAddress().focus());
    expect(getAddress().value).toBe("http://localhost:3000/");
    expect([getAddress().selectionStart, getAddress().selectionEnd]).toEqual([0, 22]);
    act(() => getAddress().blur());

    rerenderTab(createBrowserTabSummaryFixture({ url: "about:blank" }));

    expect(getAddress().value).toBe("");
  });

  test("selects the whole address on the first click, and places the caret on the next one", () => {
    renderToolbar({ tab: createBrowserTabSummaryFixture({ url: "http://localhost:3000/" }) });
    const address = getAddress();

    fireEvent.pointerDown(address);
    address.focus();
    address.setSelectionRange(5, 5);
    fireEvent.click(address);
    expect([address.selectionStart, address.selectionEnd]).toEqual([0, address.value.length]);

    fireEvent.pointerDown(address);
    address.setSelectionRange(5, 5);
    fireEvent.click(address);
    expect([address.selectionStart, address.selectionEnd]).toEqual([5, 5]);
  });

  test("loads a typed address with the scheme that fits its host", () => {
    const { props } = renderToolbar();

    typeAddress("localhost:5173/settings");
    pressKey("Enter");
    expect(props.onAddressLoad).toHaveBeenCalledTimes(1);
    typeAddress("example.com");
    pressKey("Enter");

    expect(props.onNavigate).toHaveBeenNthCalledWith(1, {
      kind: "address",
      address: "http://localhost:5173/settings",
    });
    expect(props.onNavigate).toHaveBeenNthCalledWith(2, {
      kind: "address",
      address: "https://example.com/",
    });
  });

  test("shows an inline error until the next page for text that is not an address", () => {
    const { props, rerenderTab } = renderToolbar();

    typeAddress("how to center a div");
    pressKey("Enter");

    expect(screen.getByRole("alert").textContent).toBe(
      "This is not a web address. Type an address such as localhost:3000 or example.com.",
    );
    expect(getAddress().getAttribute("aria-invalid")).toBe("true");
    expect(props.onNavigate).not.toHaveBeenCalled();

    rerenderTab(createBrowserTabSummaryFixture({ url: "http://localhost:3000/next" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("names a refused scheme and loads nothing", () => {
    const { props } = renderToolbar();

    typeAddress("file:///etc/hosts");
    pressKey("Enter");

    expect(screen.getByRole("alert").textContent).toContain("file: addresses");
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  test("restores and selects the page URL on Escape and clears the error", () => {
    renderToolbar();

    act(() => getAddress().focus());
    typeAddress("not an address");
    pressKey("Enter");
    pressKey("Escape");

    const input = getAddress();
    expect(input.value).toBe("http://localhost:3000/");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows the message of a rejected navigation", async () => {
    renderToolbar({
      onNavigate: mock(async (_navigation: BrowserNavigation) => {
        throw new Error("The tab is closed.");
      }),
    });

    typeAddress("localhost:3000");
    pressKey("Enter");

    expect((await screen.findByRole("alert")).textContent).toBe("The tab is closed.");
  });

  test("shows the new page URL after a submitted address and keeps a draft while the user types", () => {
    const { rerenderTab } = renderToolbar();

    typeAddress("localhost:4000");
    pressKey("Enter");
    expect(getAddress().value).toBe("localhost:4000");
    rerenderTab(createBrowserTabSummaryFixture({ url: "http://localhost:4000/login" }));
    expect(getAddress().value).toBe("localhost:4000/login");

    act(() => getAddress().focus());
    typeAddress("localhost:5000");
    rerenderTab(createBrowserTabSummaryFixture({ url: "http://localhost:4000/home" }));
    expect(getAddress().value).toBe("localhost:5000");
  });

  test("a submitted address does not come back when the page returns to its old URL", () => {
    const { rerenderTab } = renderToolbar({
      tab: createBrowserTabSummaryFixture({ url: "https://example.com/" }),
    });

    typeAddress("localhost:5199");
    pressKey("Enter");
    rerenderTab(createBrowserTabSummaryFixture({ url: "http://localhost:5199/" }));
    rerenderTab(createBrowserTabSummaryFixture({ url: "https://example.com/" }));

    expect(getAddress().value).toBe("example.com");
  });

  test("focuses and selects the address bar when the focus request grows", () => {
    const { view, props } = renderToolbar();
    expect(document.activeElement).not.toBe(getAddress());

    view.rerender(<BrowserToolbar {...props} addressFocusRequest={1} />);

    const input = getAddress();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  test("a web runner tab shows only the page controls, because its page uses this browser", () => {
    renderToolbar({ tools: null });

    for (const name of ["Back", "Forward", "Reload"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const name of ["Site settings", "Annotate", "Pending annotations", "Share with agents"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  test("toggles the picker and shows its pressed state", () => {
    const { tools, rerenderTools } = renderToolbar();
    expect(getButton("Annotate").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(getButton("Annotate"));
    rerenderTools({ pickerActive: true });

    expect(tools.onTogglePicker).toHaveBeenCalledTimes(1);
    expect(getButton("Annotate").getAttribute("aria-pressed")).toBe("true");
  });

  test("shows the pending annotation count and the annotation list in a popover", async () => {
    renderToolbar({}, { annotationCount: 2 });

    fireEvent.click(getButton("Pending annotations: 2"));

    const popover = await screen.findByRole("dialog", { name: "Pending annotations: 2" });
    expect(within(popover).getByText("Annotation list")).toBeTruthy();
  });

  test("shows the site menu in a popover", async () => {
    renderToolbar();

    fireEvent.click(getButton("Site settings"));

    const popover = await screen.findByRole("dialog", { name: "Site settings" });
    expect(within(popover).getByText("Site menu")).toBeTruthy();
  });

  test("shares a user tab with agents and shows a rejected change", async () => {
    const onSetShared = mock(async (_shared: boolean) => {});
    const { rerenderTab } = renderToolbar({}, { onSetShared });
    const share = getButton("Share with agents");
    expect(share.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(share);
    expect(onSetShared).toHaveBeenCalledWith(true);
    expect(getButton("Share with agents").disabled).toBe(true);

    rerenderTab(createBrowserTabSummaryFixture({ shared: true }));
    await waitFor(() => expect(getButton("Share with agents").disabled).toBe(false));
    expect(getButton("Share with agents").getAttribute("aria-pressed")).toBe("true");
    onSetShared.mockImplementation(async () => {
      throw new Error("The host cannot change sharing now.");
    });
    fireEvent.click(getButton("Share with agents"));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The host cannot change sharing now.",
    );
    expect(onSetShared).toHaveBeenLastCalledWith(false);
  });

  test("shows an agent badge in place of Share with agents for an agent tab", () => {
    renderToolbar({ tab: createBrowserTabSummaryFixture({ createdBy: "agent" }) });

    expect(screen.queryByRole("button", { name: "Share with agents" })).toBeNull();
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  test("shows the DevTools toggle only when the engine supports it", () => {
    const { tools, rerenderTools } = renderToolbar();
    expect(screen.queryByRole("button", { name: "DevTools" })).toBeNull();

    rerenderTools({ supportsDevTools: true });
    fireEvent.click(getButton("DevTools"));
    expect(tools.onToggleDevTools).toHaveBeenCalledTimes(1);
    expect(getButton("DevTools").getAttribute("aria-pressed")).toBe("false");

    rerenderTools({ supportsDevTools: true, devToolsOpen: true });
    expect(getButton("DevTools").getAttribute("aria-pressed")).toBe("true");
  });

  test("shows the downloads menu only when it has content", async () => {
    const { rerenderTools } = renderToolbar();
    expect(screen.queryByRole("button", { name: "Downloads" })).toBeNull();

    rerenderTools({ downloadsContent: <p>Download list</p> });
    fireEvent.click(getButton("Downloads"));

    const popover = await screen.findByRole("dialog", { name: "Downloads" });
    expect(within(popover).getByText("Download list")).toBeTruthy();
  });
});
