import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { initialSpeedState, type AgentModelCatalog } from "@openducktor/core";
import { SpeedSelect } from "@/components/features/agents/speed-select";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { useSpeedControl } from "./use-speed-control";

enableReactActEnvironment();
const catalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  defaultModelsByProvider: {},
  models: [
    {
      id: "model",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "model",
      modelName: "Model",
      variants: [],
      speedLevels: [
        { id: "standard", label: "Standard" },
        { id: "priority", label: "Fast" },
        { id: "ultrafast", label: "Ultrafast" },
      ],
    },
  ],
};
const selection = { providerId: "openai", modelId: "model" };

test.each(["standard", "priority", null])(
  "shows a requested level at once and restores %s on failure",
  async (choice) => {
    const nextChoice = choice === null ? "standard" : "ultrafast";
    const request = Promise.withResolvers<void>();
    const change = mock(() => request.promise);
    function Control() {
      return (
        <SpeedSelect
          model={useSpeedControl({
            key: "session",
            livePresence: "present",
            runtimeKind: "codex",
            catalog,
            model: selection,
            choice,
            state: initialSpeedState(choice, "confirmed"),
            onChange: change,
          })}
        />
      );
    }
    render(<Control />);
    const button = screen.getByRole("button");
    const before = button.textContent;
    await act(async () => fireEvent.click(button));
    await act(async () =>
      fireEvent.click(
        screen.getByRole("option", { name: choice === null ? "Standard" : "Ultrafast" }),
      ),
    );
    expect(screen.getByRole("button")).toBe(button);
    expect(button.textContent).toBe(choice === null ? "Standard" : "Ultrafast");
    expect(button.querySelector(".animate-spin")).toBeNull();
    await waitFor(() => expect(change).toHaveBeenCalledWith(nextChoice));
    await act(async () => request.reject(new Error("The setting could not be saved.")));
    expect(button.textContent).toBe(before);
    expect(screen.getByLabelText("Speed").classList.contains("is-shaking")).toBe(true);
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);

test("a late mutation remains tied to its original session", async () => {
  const request = Promise.withResolvers<void>();
  const first = mock(() => request.promise);
  const second = mock(async () => {});
  const { result, rerender } = renderHook(
    ({ key }) =>
      useSpeedControl({
        key,
        livePresence: "present",
        runtimeKind: "codex",
        catalog,
        model: selection,
        choice: "standard",
        onChange: key === "first" ? first : second,
      }),
    { initialProps: { key: "first" } },
  );
  act(() => result.current?.onChange("ultrafast"));
  await waitFor(() => expect(result.current?.pending).toBe(true));
  expect(result.current?.state.choice).toBe("ultrafast");
  rerender({ key: "second" });
  expect(result.current?.pending).toBe(false);
  await act(async () => {
    request.reject(new Error("First session rejected the setting"));
    await request.promise.catch(() => {});
  });
  expect(result.current?.error).toBe(null);
  expect(result.current?.state.choice).toBe("standard");
  expect(first).toHaveBeenCalledWith("ultrafast");
  expect(second).not.toHaveBeenCalled();
});

test("a live recovery overrides an old catalog restriction", () => {
  const availability = {
    status: "blocked" as const,
    reason: { code: "account", message: "Check your account." },
  };
  const { result, rerender } = renderHook(
    ({ available }) =>
      useSpeedControl({
        key: "session",
        livePresence: "present",
        runtimeKind: "codex",
        catalog: { ...catalog, speedAvailability: availability },
        model: selection,
        choice: "standard",
        state: {
          ...initialSpeedState("standard", "confirmed"),
          availability: available ? { status: "available" } : { status: "unknown" },
        },
        onChange: async () => {},
      }),
    { initialProps: { available: false } },
  );
  expect(result.current?.state.availability.status).toBe("blocked");
  rerender({ available: true });
  expect(result.current?.state.availability.status).toBe("available");
});
