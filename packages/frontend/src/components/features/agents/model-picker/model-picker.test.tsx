import { describe, expect, mock, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { ModelPicker, type ModelPickerFavoriteState } from "./model-picker";
import type { ModelPickerCatalogResource, ModelPickerRuntime } from "./model-picker-model";

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
      contextWindow: 200_000,
      attachmentSupport: {
        image: true,
        video: true,
        audio: false,
        pdf: true,
      },
    },
  ],
  defaultModelsByProvider: {},
});

const resource = (runtimeKind: "opencode" | "codex"): ModelPickerCatalogResource => ({
  status: "ready",
  catalog: catalog(runtimeKind),
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

  test("keeps foreign runtimes visible, inert, and explained in a locked context", async () => {
    const onValueChange = mock(() => {});
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
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByRole("button", { name: "OpenCode runtime" }).hasAttribute("disabled")).toBe(
      false,
    );
    const lockedRuntime = screen.getByRole("button", {
      name: "Codex runtime",
      description: "Start a new session to switch runtimes.",
    });
    await act(async () => {
      lockedRuntime.focus();
    });
    expect(document.activeElement).toBe(lockedRuntime);
    expect(lockedRuntime.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(lockedRuntime, { key: "Enter" });
      fireEvent.click(lockedRuntime);
    });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getAllByText("GPT Five")).toHaveLength(2);
    expect(screen.queryByText("GPT 5 Codex")).toBeNull();
  });

  test.each(["Enter", " "])(
    "keeps a read-only trigger focusable and closed for %s",
    async (key) => {
      const onValueChange = mock(() => {});
      const onOpenChange = mock(() => {});
      render(
        <ModelPicker
          runtimes={runtimes}
          value={value}
          favoriteState={favoriteState()}
          selectionPolicy={{
            kind: "read_only",
            reason: "Reuse mode keeps the source session runtime and model.",
          }}
          onValueChange={onValueChange}
          onOpenChange={onOpenChange}
        />,
      );

      const trigger = screen.getByRole("button", {
        name: "Select model, OpenCode, GPT Five",
        description: "Reuse mode keeps the source session runtime and model.",
      });
      await act(async () => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-disabled")).toBe("true");

      await act(async () => {
        fireEvent.keyDown(trigger, { key });
        fireEvent.keyUp(trigger, { key });
      });

      expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onValueChange).not.toHaveBeenCalled();
    },
  );

  test("keeps a retained catalog display-only while a refresh is in flight", async () => {
    const onValueChange = mock(() => {});
    const refreshingRuntimes: ModelPickerRuntime[] = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        resource: {
          status: "refreshing",
          catalog: catalog("opencode"),
          retry: async () => {},
        },
      },
    ];
    render(
      <ModelPicker
        runtimes={refreshingRuntimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByRole("status").textContent).toContain("Refreshing OpenCode models");
    expect(screen.getAllByText("GPT Five")).toHaveLength(1);
    expect(onValueChange).not.toHaveBeenCalled();
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

  test.each([
    { isFavorite: false, interaction: "hover", expectedTooltip: "Add to favorites" },
    { isFavorite: false, interaction: "focus", expectedTooltip: "Add to favorites" },
    { isFavorite: true, interaction: "hover", expectedTooltip: "Remove from favorites" },
    { isFavorite: true, interaction: "focus", expectedTooltip: "Remove from favorites" },
  ])(
    "shows the $expectedTooltip tooltip on $interaction",
    async ({ isFavorite, interaction, expectedTooltip }) => {
      render(
        <ModelPicker
          runtimes={runtimes}
          value={value}
          favoriteState={favoriteState({ favorites: isFavorite ? [value] : [] })}
          selectionPolicy={{ kind: "editable" }}
          onValueChange={() => {}}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
      });
      const favoriteAction = screen.getByRole("button", {
        name: isFavorite ? "Remove GPT Five from favorites" : "Add GPT Five to favorites",
      });
      await act(async () => {
        if (interaction === "hover") {
          fireEvent.pointerMove(favoriteAction);
          return;
        }
        favoriteAction.focus();
      });

      await waitFor(
        () => {
          expect(screen.getByRole("tooltip").textContent).toContain(expectedTooltip);
        },
        { timeout: 750 },
      );
    },
  );

  test("keeps the unavailable favorite reason focusable without mutating", async () => {
    const toggleFavorite = mock(() => {});
    render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState({
          readError: "Settings read failed",
          canMutate: false,
          toggleFavorite,
        })}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    const favoriteAction = screen.getByRole("button", { name: "Add GPT Five to favorites" });
    await act(async () => {
      favoriteAction.focus();
    });

    expect(document.activeElement).toBe(favoriteAction);
    expect(favoriteAction.getAttribute("aria-disabled")).toBe("true");
    await waitFor(
      () => {
        expect(screen.getByRole("tooltip").textContent).toContain(
          "Favorites unavailable: Settings read failed",
        );
      },
      { timeout: 750 },
    );
    await act(async () => {
      fireEvent.click(favoriteAction);
    });
    expect(toggleFavorite).not.toHaveBeenCalled();
  });

  test("renders model selection and favorite actions as sibling buttons", async () => {
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

    const modelItem = screen.getByRole("listitem", { name: "GPT Five model actions" });
    const selectModel = within(modelItem).getByRole("button", { name: "Select GPT Five model" });
    const toggleFavorite = within(modelItem).getByRole("button", {
      name: "Add GPT Five to favorites",
    });

    expect(selectModel.parentElement).toBe(toggleFavorite.parentElement);
    expect(selectModel.contains(toggleFavorite)).toBe(false);
    expect(screen.queryByRole("option")).toBeNull();
  });

  test("moves from search through model selection buttons with arrow keys", async () => {
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
    const search = screen.getByPlaceholderText("Search models...");
    fireEvent.change(search, { target: { value: "gpt" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const openCodeModel = screen.getByRole("button", { name: "Select GPT Five model" });
    expect(document.activeElement).toBe(openCodeModel);
    fireEvent.keyDown(openCodeModel, { key: "ArrowDown" });

    const codexModel = screen.getByRole("button", { name: "Select GPT 5 Codex model" });
    expect(document.activeElement).toBe(codexModel);
    fireEvent.click(codexModel);

    expect(onValueChange).toHaveBeenCalledWith({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
    });
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
    await act(async () => {
      star.focus();
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
    await act(async () => {
      star.focus();
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
    const failedRuntimes: ModelPickerRuntime[] = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        resource: {
          status: "failed",
          catalog: catalog("opencode"),
          error: "Catalog refetch failed",
          retry: async () => {},
        },
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

  test("shows context window and attachment support without the redundant runtime name", async () => {
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

    expect(screen.getByText("OpenAI · gpt-5 · 200K context")).toBeTruthy();
    expect(screen.queryByText(/OpenCode · OpenAI/)).toBeNull();
    expect(screen.getByRole("img", { name: "Supports images" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Supports videos" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Supports PDF files" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Supports audio" })).toBeNull();
  });

  test("omits context and capability icons when the model descriptor lacks them", async () => {
    const bareCatalog: AgentModelCatalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT Five",
          variants: [],
        },
      ],
      defaultModelsByProvider: {},
    };
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            resource: { status: "ready", catalog: bareCatalog },
          },
        ]}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByText("OpenAI · gpt-5")).toBeTruthy();
    expect(screen.queryByText(/context/)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
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
