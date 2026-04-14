import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

describe("Toaster", () => {
  beforeEach(() => {
    mock.module("@radix-ui/react-dismissable-layer", () => ({
      DismissableLayerBranch: ({ children }: { children: ReactNode }) => (
        <div data-testid="dismissable-layer-branch">{children}</div>
      ),
    }));

    mock.module("sonner", () => ({
      Toaster: (props: Record<string, unknown>) => (
        <div data-testid="sonner-toaster" data-props={JSON.stringify(props)} />
      ),
    }));
  });

  afterAll(async () => {
    await restoreMockedModules([
      ["@radix-ui/react-dismissable-layer", () => import("@radix-ui/react-dismissable-layer")],
      ["sonner", () => import("sonner")],
    ]);
  });

  test("mounts the global toaster inside a dismissable layer branch", async () => {
    const { Toaster } = await import("./sonner");

    render(<Toaster duration={1234} />);

    const branch = screen.getByTestId("dismissable-layer-branch");
    const toaster = screen.getByTestId("sonner-toaster");
    const props = JSON.parse(toaster.getAttribute("data-props") ?? "{}");

    expect(branch.contains(toaster)).toBe(true);
    expect(props.position).toBe("bottom-right");
    expect(props.closeButton).toBe(true);
    expect(props.expand).toBe(true);
    expect(props.visibleToasts).toBe(5);
    expect(props.duration).toBe(1234);
  });
});
