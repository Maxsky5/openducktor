import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ArrowUp } from "lucide-react";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const getNodeText = (node: TestRenderer.ReactTestInstance): string => {
  return (node.children as unknown[])
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (child != null && typeof child === "object" && "children" in child) {
        return getNodeText(child as TestRenderer.ReactTestInstance);
      }
      return "";
    })
    .join("");
};

const ensureRenderer = (
  renderer: TestRenderer.ReactTestRenderer | null,
): TestRenderer.ReactTestRenderer => {
  if (!renderer) {
    throw new Error("GitConfirmationDialog renderer is not initialized");
  }

  return renderer;
};

const findByTestId = (
  root: TestRenderer.ReactTestInstance,
  testId: string,
): TestRenderer.ReactTestInstance => {
  const matches = root.findAll(
    (node) => node.props["data-testid"] === testId && typeof node.type === "string",
  );

  if (matches.length !== 1) {
    throw new Error(`Expected one host node for data-testid=${testId}, got ${matches.length}`);
  }

  const match = matches[0];
  if (!match) {
    throw new Error(`Missing host node for data-testid=${testId}`);
  }

  return match;
};

describe("GitConfirmationDialog", () => {
  let GitConfirmationDialog: typeof import("./git-confirmation-dialog")["GitConfirmationDialog"];

  beforeEach(async () => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };

    ({ GitConfirmationDialog } = await import("./git-confirmation-dialog"));
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("keeps the normal confirm label when disabled but not pending", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(
          GitConfirmationDialog,
          {
            open: true,
            onOpenChange: () => {},
            title: "Confirm force push",
            description: "Force push description",
            closeDisabled: false,
            onClose: () => {},
            closeTestId: "close-button",
            confirmLabel: "Force push with lease",
            confirmPendingLabel: "Force pushing...",
            confirmPending: false,
            confirmDisabled: true,
            onConfirm: () => {},
            confirmTestId: "confirm-button",
            confirmIcon: ArrowUp,
            contentTestId: "dialog",
          },
          createElement("div", null, "Body"),
        ),
      );
      await flush();
    });

    const root = ensureRenderer(renderer).root;
    const confirmButton = findByTestId(root, "confirm-button");

    expect(getNodeText(confirmButton)).toContain("Force push with lease");
    expect(getNodeText(confirmButton)).not.toContain("Force pushing...");
    expect(Boolean(confirmButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });

  test("shows the pending confirm label only when pending is true", async () => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(
          GitConfirmationDialog,
          {
            open: true,
            onOpenChange: () => {},
            title: "Confirm force push",
            description: "Force push description",
            closeDisabled: false,
            onClose: () => {},
            closeTestId: "close-button",
            confirmLabel: "Force push with lease",
            confirmPendingLabel: "Force pushing...",
            confirmPending: true,
            confirmDisabled: true,
            onConfirm: () => {},
            confirmTestId: "confirm-button",
            confirmIcon: ArrowUp,
            contentTestId: "dialog",
          },
          createElement("div", null, "Body"),
        ),
      );
      await flush();
    });

    const root = ensureRenderer(renderer).root;
    const confirmButton = findByTestId(root, "confirm-button");

    expect(getNodeText(confirmButton)).toContain("Force pushing...");
    expect(Boolean(confirmButton.props.disabled)).toBe(true);

    await act(async () => {
      ensureRenderer(renderer).unmount();
      await flush();
    });
  });
});
