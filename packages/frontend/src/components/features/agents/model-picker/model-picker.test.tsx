import { describe, expect, mock, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { RuntimeModelCatalogResource } from "@/state/queries/use-runtime-model-catalogs";
import { ModelPicker, type ModelPickerFavoriteState } from "./model-picker";

enableReactActEnvironment();

const catalog = (runtimeKind: "opencode" | "codex"): AgentModelCatalog => ({
  runtime: runtimeKind === "opencode" ? OPENCODE_RUNTIME_DESCRIPTOR : CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: runtimeKind === "opencode" ? "GPT Five" : "GPT 5 Codex",
      variants: [],
    },
  ],
  defaultModelsByProvider: {},
});

const resource = (runtimeKind: "opencode" | "codex"): RuntimeModelCatalogResource => ({
  runtimeKind,
  catalog: catalog(runtimeKind),
  isLoading: false,
  error: null,
  retry: async () => {},
});

const opencodeRuntime = {
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
  resource: resource("opencode"),
};
const codexRuntime = {
  descriptor: CODEX_RUNTIME_DESCRIPTOR,
  resource: resource("codex"),
};
const runtimes = [opencodeRuntime, codexRuntime];

const value: AgentModelFavorite = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
};

const favoriteState = (
  overrides: Partial<ModelPickerFavoriteState> = {},
): ModelPickerFavoriteState => ({
  favorites: [],
  isLoading: false,
  readError: null,
  isMutationPending: false,
  mutationError: null,
  canMutate: true,
  toggleFavorite: mock(() => {}),
  retryRead: mock(() => {}),
  retryMutation: mock(() => {}),
  ...overrides,
});

describe("ModelPicker", () => {
  test("shows the selected runtime icon and model label in the trigger", () => {
    const { container } = render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" })).toBeTruthy();
    expect(container.querySelector('svg[viewBox="0 0 512 512"]')).toBeTruthy();
  });

  test("keeps foreign runtimes visible and disabled in a locked context", async () => {
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "runtime_locked",
          runtimeKind: "opencode",
          reason: "Start a new session to switch runtimes.",
        }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByRole("button", { name: "OpenCode runtime" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Codex runtime" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("toggles a favorite without selecting the row or closing the picker", async () => {
    const toggleFavorite = mock(() => {});
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState({ toggleFavorite })}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add GPT Five to favorites" }));
    });

    expect(toggleFavorite).toHaveBeenCalledWith(value);
    expect(onValueChange).toHaveBeenCalledTimes(0);
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();
  });

  test("shows the settings read failure before an overlapping mutation failure", async () => {
    const retryRead = mock(() => {});
    const retryMutation = mock(() => {});
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState({
          readError: "Settings refetch failed",
          mutationError: "Favorite write failed",
          canMutate: false,
          retryRead,
          retryMutation,
        })}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Favorites unavailable: Settings refetch failed",
    );
    expect(screen.queryByText("Favorite write failed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryRead).toHaveBeenCalledTimes(1);
    expect(retryMutation).not.toHaveBeenCalled();
  });

  test.each([
    { key: "Enter", label: "Enter" },
    { key: " ", label: "Space" },
  ])("keeps $label favorite activation inside the star action", async ({ key }) => {
    const toggleFavorite = mock(() => {});
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState({ toggleFavorite })}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    const search = screen.getByPlaceholderText("Search models...") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "gpt" } });
    const star = screen.getByRole("button", { name: "Add GPT Five to favorites" });
    star.focus();
    await act(async () => {
      fireEvent.keyDown(star, { key });
      fireEvent.keyUp(star, { key });
      fireEvent.click(star);
    });

    expect(toggleFavorite).toHaveBeenCalledTimes(1);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();
    expect(search.value).toBe("gpt");
  });

  test("lets Escape close the picker when the star has focus", async () => {
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    const star = screen.getByRole("button", { name: "Add GPT Five to favorites" });
    star.focus();
    await act(async () => {
      fireEvent.keyDown(star, { key: "Escape" });
    });

    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
  });

  test.each([
    { name: "editable", policy: { kind: "editable" } as const },
    {
      name: "runtime locked",
      policy: {
        kind: "runtime_locked",
        runtimeKind: "opencode",
        reason: "Start a new session to switch runtimes.",
      } as const,
    },
  ])("keeps failed retained rows display-only when $name", async ({ policy }) => {
    const failedRuntimes = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        resource: { ...resource("opencode"), error: "Catalog refetch failed" },
      },
      codexRuntime,
    ];
    render(
      <ModelPicker
        runtimes={failedRuntimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={policy}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByRole("alert").textContent).toContain("Catalog refetch failed");
    expect(screen.getAllByText("GPT Five")).toHaveLength(1);
  });

  test("emits the exact pair and closes after model selection", async () => {
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Codex runtime" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("GPT 5 Codex"));
    });

    expect(onValueChange).toHaveBeenCalledWith({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
    });
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
  });
});
