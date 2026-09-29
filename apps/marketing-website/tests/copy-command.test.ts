import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { commands } from "../src/content/site";
import { bindCopyCommands } from "../src/ui/copy-command";

// The site tests share one process, so the browser globals exist only while this file runs.
let clipboardDescriptor: PropertyDescriptor | undefined;
beforeAll(() => {
  GlobalRegistrator.register();
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
});
afterEach(() => {
  document.body.innerHTML = "";
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function fixture(visible: string = commands.brew) {
  document.body.innerHTML = `<div data-command="${commands.brew}"><pre><code>${visible}</code></pre><button hidden aria-label="Copy command: Homebrew">Copy command</button><p role="status"></p></div>`;
  const button = document.querySelector("button");
  const status = document.querySelector('[role="status"]');
  if (!button || !status) throw new Error("Incomplete command fixture");
  bindCopyCommands(document);
  return { button, status };
}

test("copies the exact visible command and announces success only after resolution", async () => {
  const { button, status } = fixture();
  let complete: () => void = () => {};
  const write = mock(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: write },
    configurable: true,
  });
  button.focus();
  button.click();
  button.click();
  expect(button.hidden).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith(commands.brew);
  expect(status.textContent).toBe("");
  complete();
  await Promise.resolve();
  expect(status.textContent).toBe("Command copied.");
  expect(button.dataset.copyState).toBe("copied");
  expect(button.getAttribute("aria-label")).toBe("Command copied");
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
});

test.each(["missing", "rejected"])(
  "shows an honest failure when clipboard is %s",
  async (failure) => {
    const { button, status } = fixture();
    Object.defineProperty(navigator, "clipboard", {
      value:
        failure === "missing"
          ? undefined
          : { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    button.click();
    await Promise.resolve();
    expect(status.textContent).toBe("Could not copy. Select the command and copy it.");
    expect(document.querySelector("code")?.textContent).toBe(commands.brew);
    expect(button.disabled).toBe(false);
  },
);

test("copies the full command while the terminal still types it", async () => {
  const { button } = fixture("brew install");
  const write = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: write },
    configurable: true,
  });
  button.click();
  await Promise.resolve();
  expect(write).toHaveBeenCalledWith(commands.brew);
});

test("fails with an actionable error when a command block has no command", () => {
  document.body.innerHTML = `<div data-command=""><button hidden></button><p role="status"></p></div>`;
  expect(() => bindCopyCommands(document)).toThrow("data-command value");
});
