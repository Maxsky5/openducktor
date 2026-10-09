import { expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { act, renderHook } from "@testing-library/react";
import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useSpeedDraft } from "./use-speed-draft";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";

enableReactActEnvironment();
const selection = { providerId: "openai", modelId: "model" };
type CatalogProps = { read: AgentModelCatalog | null };
const catalog = (levels?: string[]): AgentModelCatalog => {
  const model: AgentModelCatalog["models"][number] = {
    id: "model",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "model",
    modelName: "Model",
    variants: [],
  };
  if (levels) model.speedLevels = levels.map((id) => ({ id, label: id }));
  return {
    runtime: CODEX_RUNTIME_DESCRIPTOR,
    defaultModelsByProvider: {},
    models: [model],
  };
};

test("retains Ultrafast through unknown reads and resets when that level is absent", () => {
  const notice = spyOn(toast, "info").mockImplementation(() => "notice");
  try {
    const initialProps: CatalogProps = {
      read: catalog(["standard", "priority", "ultrafast"]),
    };
    const { result, rerender } = renderHook(
      ({ read }: CatalogProps) => useSpeedDraft("request", "codex", read, selection),
      {
        initialProps,
      },
    );
    act(() => result.current.setChoice("ultrafast"));
    rerender({ read: null });
    expect(result.current.choice).toBe("ultrafast");
    rerender({ read: catalog() });
    expect(result.current.choice).toBe("ultrafast");
    rerender({ read: catalog(["standard", "priority", "ultrafast"]) });
    expect(result.current.choice).toBe("ultrafast");
    expect(notice).not.toHaveBeenCalled();
    rerender({ read: catalog(["standard", "priority"]) });
    expect(result.current.choice).toBe("standard");
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(
      "Speed was set to Standard because this model does not support the previous level.",
    );
    rerender({ read: catalog(["standard", "priority", "ultrafast"]) });
    expect(result.current.choice).toBe("standard");
    expect(notice).toHaveBeenCalledTimes(1);
  } finally {
    notice.mockRestore();
  }
});

test("new requests and runtime changes discard the prior draft choice", () => {
  const { result, rerender } = renderHook(
    ({ key, runtime }: { key: string; runtime: "codex" | "claude" }) =>
      useSpeedDraft(key, runtime, catalog(["standard", "fast", "ultrafast"]), selection),
    { initialProps: { key: "first", runtime: "codex" } },
  );
  act(() => result.current.setChoice("ultrafast"));
  rerender({ key: "second", runtime: "codex" });
  expect(result.current.choice).toBe("standard");
  act(() => result.current.setChoice("fast"));
  rerender({ key: "second", runtime: "claude" });
  expect(result.current.choice).toBe("standard");
});
