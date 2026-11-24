import { describe, expect, mock, test } from "bun:test";
import {
  type AgentModelFavorite,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, useState } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { ModelPicker } from "./model-picker";
import type {
  ModelPickerCatalogResource,
  ModelPickerRuntime,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";

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

const makeRuntimes = (): ModelPickerRuntime[] => [
  {
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    isEnabledForFavorites: true,
    resource: resource("opencode"),
  },
  {
    descriptor: CODEX_RUNTIME_DESCRIPTOR,
    isEnabledForFavorites: true,
    resource: resource("codex"),
  },
];

const makeLargeRuntimes = (count = 80): ModelPickerRuntime[] => [
  {
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    isEnabledForFavorites: true,
    resource: {
      status: "ready",
      catalog: {
        runtime: OPENCODE_RUNTIME_DESCRIPTOR,
        models: Array.from({ length: count }, (_, index) => ({
          id: `openai/model-${index}`,
          providerId: "openai",
          providerName: "OpenAI",
          modelId: `model-${index}`,
          modelName: `Model ${index}`,
          variants: [],
        })),
        defaultModelsByProvider: {},
      },
    },
  },
];

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

const defaultOptions = {
  effort: {
    options: [],
    value: undefined,
    onSelect: () => {},
  },
};

describe("ModelPicker", () => {
  test.each([
    {
      name: "Favorites when a favorite exists",
      selectedValue: { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" },
      triggerName: "Select model, Codex, GPT 5 Codex",
      favorites: [value],
      expectedView: "Favorite models",
      expectedModel: "Select GPT Five model",
      switchToView: "Codex runtime",
    },
    {
      name: "the selected runtime when there are no favorites",
      selectedValue: { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" },
      triggerName: "Select model, Codex, GPT 5 Codex",
      favorites: [],
      expectedView: "Codex runtime",
      expectedModel: "Select GPT 5 Codex model",
      switchToView: "OpenCode runtime",
    },
    {
      name: "the first runtime when no model is selected and there are no favorites",
      selectedValue: null,
      triggerName: "Select model, Select a model",
      favorites: [],
      expectedView: "OpenCode runtime",
      expectedModel: "Select GPT Five model",
      switchToView: "Codex runtime",
    },
  ])(
    "opens $name on every opening",
    async ({
      selectedValue,
      triggerName,
      favorites,
      expectedView,
      expectedModel,
      switchToView,
    }) => {
      render(
        <ModelPicker
          runtimes={makeRuntimes()}
          value={selectedValue}
          favoriteState={favoriteState({ favorites: [...favorites] })}
          selectionPolicy={{ kind: "editable" }}
          options={defaultOptions}
          onValueChange={() => {}}
        />,
      );

      const trigger = screen.getByRole("button", { name: triggerName });
      for (let opening = 0; opening < 2; opening += 1) {
        await act(async () => {
          fireEvent.click(trigger);
        });
        expect(
          screen.getByRole("button", { name: expectedView }).getAttribute("aria-pressed"),
        ).toBe("true");
        expect(screen.getByRole("button", { name: expectedModel })).toBeTruthy();
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: switchToView }));
          fireEvent.keyDown(screen.getByRole("button", { name: switchToView }), {
            key: "Escape",
          });
        });
      }
    },
  );

  test("opens the available runtime when its only favorite belongs to a disabled runtime", async () => {
    const disabledRuntime = { ...makeRuntimes()[0]!, isEnabledForFavorites: false };
    render(
      <ModelPicker
        runtimes={[disabledRuntime, makeRuntimes()[1]!]}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState({ favorites: [value] })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Codex, GPT 5 Codex" }));
    });
    expect(screen.getByRole("button", { name: "Codex runtime" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Select GPT 5 Codex model" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select GPT Five model" })).toBeNull();
  });

  test("shows only favorites from available runtimes", async () => {
    const disabledRuntime = { ...makeRuntimes()[0]!, isEnabledForFavorites: false };
    render(
      <ModelPicker
        runtimes={[disabledRuntime, makeRuntimes()[1]!]}
        value={null}
        favoriteState={favoriteState({
          favorites: [value, { ...value, runtimeKind: "codex" }],
        })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });
    expect(
      screen.getByRole("button", { name: "Favorite models" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Select GPT 5 Codex model" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select GPT Five model" })).toBeNull();
  });

  test("keeps a disabled session runtime selectable but out of Favorites", async () => {
    const disabledRuntime = { ...makeRuntimes()[0]!, isEnabledForFavorites: false };
    render(
      <ModelPicker
        runtimes={[disabledRuntime]}
        value={value}
        favoriteState={favoriteState({ favorites: [value] })}
        selectionPolicy={{
          kind: "runtime_locked",
          runtimeKind: "opencode",
          reason: "An existing session cannot change runtime.",
        }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    expect(
      screen.getByRole("button", { name: "OpenCode runtime" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Select GPT Five model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove GPT Five from favorites" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Favorite models" }));
    });
    expect(screen.queryByRole("button", { name: "Select GPT Five model" })).toBeNull();
  });

  test.each([
    { favorites: [value], expectedView: "Favorite models" },
    {
      favorites: [{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }],
      expectedView: "OpenCode runtime",
    },
  ] as const)("opens a locked runtime on $expectedView", async ({ favorites, expectedView }) => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState({ favorites: [...favorites] })}
        selectionPolicy={{
          kind: "runtime_locked",
          runtimeKind: "opencode",
          reason: "Start a new session to switch runtimes.",
        }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    expect(screen.getByRole("button", { name: expectedView }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Select GPT Five model" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select GPT 5 Codex model" })).toBeNull();
  });

  test("shows the selected runtime icon and model label in the trigger", () => {
    const { container } = render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "runtime_locked",
          runtimeKind: "opencode",
          reason: "Start a new session to switch runtimes.",
        }}
        options={defaultOptions}
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

  test.each(["Enter", " ", "click"])(
    "keeps a read-only trigger focusable and closed for %s",
    async (key) => {
      const onValueChange = mock(() => {});
      const onOpenChange = mock(() => {});
      render(
        <ModelPicker
          runtimes={makeRuntimes()}
          value={value}
          favoriteState={favoriteState()}
          selectionPolicy={{
            kind: "read_only",
            reason: "Reuse mode keeps the source session runtime and model.",
          }}
          options={defaultOptions}
          onValueChange={onValueChange}
          onOpenChange={onOpenChange}
        />,
      );

      const trigger = screen.getByRole("button", {
        name: "Select model, OpenCode, GPT Five. Reuse mode keeps the source session runtime and model.",
        description: "Reuse mode keeps the source session runtime and model.",
      });
      await act(async () => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-disabled")).toBe("true");

      await act(async () => {
        if (key === "click") {
          fireEvent.click(trigger);
        } else {
          fireEvent.keyDown(trigger, { key });
          fireEvent.keyUp(trigger, { key });
        }
      });

      expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onValueChange).not.toHaveBeenCalled();
    },
  );

  test("keeps the model trigger mounted while saving a selection", async () => {
    const runtimes = makeLargeRuntimes(2);
    const favorites = favoriteState();
    const onValueChange = mock(() => {});
    let finishSave = (): void => {};

    function Harness() {
      const [selection, setSelection] = useState<AgentModelFavorite>({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "model-0",
      });
      const [isSaving, setSaving] = useState(false);
      finishSave = () => setSaving(false);
      return (
        <ModelPicker
          runtimes={runtimes}
          value={selection}
          favoriteState={favorites}
          selectionPolicy={
            isSaving
              ? { kind: "read_only", reason: "Saving model selection." }
              : { kind: "runtime_locked", runtimeKind: "opencode", reason: "Session runtime." }
          }
          options={defaultOptions}
          onValueChange={(nextSelection) => {
            onValueChange();
            setSelection(nextSelection);
            setSaving(true);
          }}
        />
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Select model, OpenCode, Model 0" });
    await act(async () => {
      trigger.focus();
      fireEvent.click(trigger);
    });
    await act(async () => {
      const model = screen.getByRole("button", { name: "Select Model 1 model" });
      model.focus();
      fireEvent.click(model);
    });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(trigger.isConnected).toBe(true);
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();

    await act(async () => finishSave());
    expect(trigger.isConnected).toBe(true);
    expect(trigger.getAttribute("aria-disabled")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("Select model, OpenCode, Model 1");
  });

  test("shows one loader for all runtimes whose catalogs are not loaded yet", async () => {
    const loadingRuntimes: ModelPickerRuntime[] = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: { status: "loading", catalog: null, retry: async () => {} },
      },
      {
        descriptor: CODEX_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: { status: "loading", catalog: null, retry: async () => {} },
      },
    ];
    render(
      <ModelPicker
        runtimes={loadingRuntimes}
        value={null}
        favoriteState={favoriteState({ favorites: [value] })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("Loading models…");
  });

  test("removes a favorite that was saved as an alias", async () => {
    const toggleFavorite = mock(() => {});
    const savedAlias = { ...value, modelId: "gpt-five" };
    const opencodeCatalog = catalog("opencode");
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: {
              status: "ready",
              catalog: {
                ...opencodeCatalog,
                models: opencodeCatalog.models.map((model) => ({
                  ...model,
                  aliases: ["gpt-five"],
                })),
              },
            },
          },
        ]}
        value={value}
        favoriteState={favoriteState({ favorites: [savedAlias], toggleFavorite })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={mock(() => {})}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove GPT Five from favorites" }));
    });

    expect(toggleFavorite).toHaveBeenCalledWith(value, [savedAlias]);
  });

  test("toggles a favorite without selecting the row or closing the picker", async () => {
    const toggleFavorite = mock(() => {});
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState({ toggleFavorite })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add GPT Five to favorites" }));
    });

    expect(toggleFavorite).toHaveBeenCalledWith(value, []);
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
          runtimes={makeRuntimes()}
          value={value}
          favoriteState={favoriteState({ favorites: isFavorite ? [value] : [] })}
          selectionPolicy={{ kind: "editable" }}
          options={defaultOptions}
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

  // Opens the full picker and waits for its focus tooltip portal.
  test("keeps the unavailable favorite reason focusable without mutating", async () => {
    const toggleFavorite = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState({
          readError: "Settings read failed",
          canMutate: false,
          toggleFavorite,
        })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
  }, 2_500);

  test("renders model selection and favorite actions as sibling buttons", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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

  test("mounts only visible rows and navigates the full catalog", async () => {
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeLargeRuntimes()}
        value={null}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        getModelDisabledReason={(item) => (item.model.modelId === "model-1" ? "Unavailable" : null)}
        options={defaultOptions}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });

    const list = screen.getByRole("list", { name: "Models" });
    // Happy DOM has no Element.scrollTo, so emit the scroll event it would send.
    Object.defineProperty(list, "scrollTo", {
      value: ({ top }: { top: number }) => {
        list.scrollTop = top;
        fireEvent.scroll(list);
      },
    });
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(20);
    expect(screen.queryByRole("button", { name: "Select Model 79 model" })).toBeNull();

    const search = screen.getByRole("textbox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    let focused = screen.getByRole("button", { name: "Select Model 0 model" });
    expect(document.activeElement).toBe(focused);
    expect(focused.closest("li")?.getAttribute("aria-posinset")).toBe("1");
    expect(focused.closest("li")?.getAttribute("aria-setsize")).toBe("80");

    fireEvent.keyDown(focused, { key: "ArrowDown" });
    focused = screen.getByRole("button", { name: "Select Model 2 model" });
    expect(document.activeElement).toBe(focused);

    await act(async () => {
      fireEvent.keyDown(focused, { key: "End" });
    });
    focused = screen.getByRole("button", { name: "Select Model 79 model" });
    expect(document.activeElement).toBe(focused);
    expect(focused.closest("li")?.getAttribute("aria-posinset")).toBe("80");

    await act(async () => {
      fireEvent.keyDown(focused, { key: "ArrowDown" });
    });
    focused = screen.getByRole("button", { name: "Select Model 0 model" });
    expect(document.activeElement).toBe(focused);

    await act(async () => {
      fireEvent.keyDown(focused, { key: "ArrowUp" });
    });
    focused = screen.getByRole("button", { name: "Select Model 79 model" });
    expect(document.activeElement).toBe(focused);

    await act(async () => {
      fireEvent.keyDown(focused, { key: "Home" });
    });
    focused = screen.getByRole("button", { name: "Select Model 0 model" });
    expect(document.activeElement).toBe(focused);

    search.focus();
    fireEvent.change(search, { target: { value: "model-79" } });
    expect(
      within(screen.getByRole("list", { name: "Models" })).getAllByRole("listitem"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Select Model 79 model" }));
    expect(onValueChange).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "model-79",
    });
  });

  test("keeps the pending keyboard target when the catalog reorders before scroll", async () => {
    const favorites = favoriteState();
    const onValueChange = mock(() => {});
    const renderPicker = (runtimes: ModelPickerRuntime[]) => (
      <ModelPicker
        runtimes={runtimes}
        value={null}
        favoriteState={favorites}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={onValueChange}
      />
    );
    const reordered = makeLargeRuntimes();
    const resource = reordered[0]!.resource;
    if (resource.status !== "ready") {
      throw new Error("The test catalog must be ready.");
    }
    const models = resource.catalog.models;
    [models[78], models[79]] = [models[79]!, models[78]!];
    const { rerender } = render(renderPicker(makeLargeRuntimes()));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });
    const list = screen.getByRole("list", { name: "Models" });
    let requestedTop = 0;
    Object.defineProperty(list, "scrollTo", {
      value: ({ top }: { top: number }) => {
        requestedTop = top;
      },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search models" }), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Select Model 0 model" }), {
      key: "End",
    });
    expect(requestedTop).toBeGreaterThan(0);

    await act(async () => {
      rerender(renderPicker(reordered));
      list.scrollTop = requestedTop;
      fireEvent.scroll(list);
    });

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Select Model 79 model");
    fireEvent.click(document.activeElement!);
    expect(onValueChange).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "model-79",
    });
  });

  test.each([
    { change: "leaves the catalog", count: 79, disableTarget: false },
    { change: "becomes disabled", count: 80, disableTarget: true },
  ])(
    "returns focus to search when the pending keyboard target $change",
    async ({ count, disableTarget }) => {
      const favorites = favoriteState();
      const renderPicker = (modelCount: number, disableModel79 = false) => (
        <ModelPicker
          runtimes={makeLargeRuntimes(modelCount)}
          value={null}
          favoriteState={favorites}
          selectionPolicy={{ kind: "editable" }}
          getModelDisabledReason={(item) =>
            disableModel79 && item.model.modelId === "model-79" ? "Unavailable" : null
          }
          options={defaultOptions}
          onValueChange={() => {}}
        />
      );
      const { rerender } = render(renderPicker(80));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
      });
      const list = screen.getByRole("list", { name: "Models" });
      Object.defineProperty(list, "scrollTo", { value: () => {} });
      const search = screen.getByRole("textbox", { name: "Search models" });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByRole("button", { name: "Select Model 0 model" }), {
        key: "End",
      });

      await act(async () => {
        rerender(renderPicker(count, disableTarget));
      });

      expect(document.activeElement).toBe(search);
    },
  );

  test.each(["Select Model 0 model", "Add Model 0 to favorites"])(
    "returns focus to search when pointer scrolling unmounts %s",
    async (focusedAction) => {
      render(
        <ModelPicker
          runtimes={makeLargeRuntimes()}
          value={null}
          favoriteState={favoriteState()}
          selectionPolicy={{ kind: "editable" }}
          options={defaultOptions}
          onValueChange={() => {}}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
      });
      const search = screen.getByRole("textbox", { name: "Search models" });
      const focusedButton = screen.getByRole("button", { name: focusedAction });
      focusedButton.focus();
      expect(document.activeElement).toBe(focusedButton);

      await act(async () => {
        const list = screen.getByRole("list", { name: "Models" });
        list.scrollTop = 52 * 40;
        fireEvent.scroll(list);
      });

      expect(screen.queryByRole("button", { name: "Select Model 0 model" })).toBeNull();
      expect(document.activeElement).toBe(search);
    },
  );

  test.each([
    { before: 29, after: 30 },
    { before: 30, after: 29 },
  ])(
    "keeps model focus when the catalog changes from $before to $after rows",
    async ({ before, after }) => {
      const favorites = favoriteState();
      const renderPicker = (count: number) => (
        <ModelPicker
          runtimes={makeLargeRuntimes(count)}
          value={null}
          favoriteState={favorites}
          selectionPolicy={{ kind: "editable" }}
          options={defaultOptions}
          onValueChange={() => {}}
        />
      );
      const { rerender } = render(renderPicker(before));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
      });
      screen.getByRole("button", { name: "Select Model 0 model" }).focus();

      await act(async () => {
        rerender(renderPicker(after));
      });

      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Select Model 0 model" }),
      );
    },
  );

  test("returns focus to search when a catalog update removes the focused model", async () => {
    const favorites = favoriteState();
    const renderPicker = (count: number) => (
      <ModelPicker
        runtimes={makeLargeRuntimes(count)}
        value={null}
        favoriteState={favorites}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />
    );
    const { rerender } = render(renderPicker(29));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });
    const search = screen.getByRole("textbox", { name: "Search models" });
    screen.getByRole("button", { name: "Select Model 28 model" }).focus();

    await act(async () => {
      rerender(renderPicker(28));
    });

    expect(screen.queryByRole("button", { name: "Select Model 28 model" })).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  test("returns focus to search when favoriting moves the focused row out of the window", async () => {
    const runtimes = makeLargeRuntimes();
    const PickerWithFavorites = () => {
      const [favorites, setFavorites] = useState<AgentModelFavorite[]>([]);
      return (
        <ModelPicker
          runtimes={runtimes}
          value={null}
          favoriteState={favoriteState({
            favorites,
            toggleFavorite: (favorite) => setFavorites([favorite]),
          })}
          selectionPolicy={{ kind: "editable" }}
          options={defaultOptions}
          onValueChange={() => {}}
        />
      );
    };
    render(<PickerWithFavorites />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
    });
    const search = screen.getByRole("textbox", { name: "Search models" });
    await act(async () => {
      const list = screen.getByRole("list", { name: "Models" });
      list.scrollTop = 52 * 40;
      fireEvent.scroll(list);
    });
    const favoriteAction = screen.getByRole("button", {
      name: "Add Model 40 to favorites",
    });
    favoriteAction.focus();

    await act(async () => {
      fireEvent.click(favoriteAction);
    });

    expect(screen.queryByRole("button", { name: "Select Model 40 model" })).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  test("shows the settings read failure before an overlapping mutation failure", async () => {
    const retryRead = mock(() => {});
    const retryMutation = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState({
          readError: "Settings refetch failed",
          mutationError: "Favorite write failed",
          canMutate: false,
          retryRead,
          retryMutation,
        })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState({ toggleFavorite })}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    const search: HTMLInputElement = screen.getByPlaceholderText("Search models...");
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
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
  ])(
    "keeps failed cached rows selectable with the error and retry when $name",
    async ({ policy }) => {
      const onValueChange = mock(() => {});
      const retry = mock(async () => {});
      const failedRuntimes: ModelPickerRuntime[] = [
        {
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          isEnabledForFavorites: true,
          resource: {
            status: "failed",
            catalog: catalog("opencode"),
            error: "Catalog refetch failed",
            retry,
          },
        },
        ...makeRuntimes().filter((runtime) => runtime.descriptor.kind === "codex"),
      ];
      render(
        <ModelPicker
          runtimes={failedRuntimes}
          value={null}
          favoriteState={favoriteState()}
          selectionPolicy={policy}
          options={defaultOptions}
          onValueChange={onValueChange}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select model, Select a model" }));
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Catalog refetch failed");
      await act(async () => {
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
      });
      expect(retry).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Select GPT Five model" }));
      });
      expect(onValueChange).toHaveBeenCalledWith(value);
    },
  );

  test("shows context window and attachment support without the redundant runtime name", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByText("OpenAI · gpt-5")).toBeTruthy();
    expect(screen.getByText("200K context")).toBeTruthy();
    expect(screen.queryByText(/OpenCode · OpenAI/)).toBeNull();
    expect(screen.getByRole("img", { name: "Supports images" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Supports videos" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Supports PDF files" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Supports audio" })).toBeNull();
  });

  test("explains each capability icon with a tooltip on hover", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    await act(async () => {
      fireEvent.pointerMove(screen.getByRole("img", { name: "Supports images" }));
    });

    await waitFor(
      () => {
        expect(screen.getByRole("tooltip").textContent).toContain(
          "Accepts image attachments like screenshots and diagrams",
        );
      },
      { timeout: 750 },
    );

    await act(async () => {
      fireEvent.pointerMove(screen.getByRole("img", { name: "Supports videos" }));
    });

    await waitFor(
      () => {
        expect(screen.getByRole("tooltip").textContent).toContain("Accepts video attachments");
      },
      { timeout: 750 },
    );

    await act(async () => {
      fireEvent.pointerMove(screen.getByRole("img", { name: "Supports PDF files" }));
    });

    await waitFor(
      () => {
        expect(screen.getByRole("tooltip").textContent).toContain(
          "Accepts PDF documents as attachments",
        );
      },
      { timeout: 750 },
    );
  });

  test("marks the selected row with a paint-only selected indicator", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search models..."), {
        target: { value: "gpt" },
      });
    });

    const selectedButton = screen.getByRole("button", { name: "Select GPT Five model" });
    const unselectedButton = screen.getByRole("button", { name: "Select GPT 5 Codex model" });

    expect(selectedButton.getAttribute("aria-pressed")).toBe("true");
    expect(selectedButton.querySelector("[data-selected-indicator]")).not.toBeNull();
    expect(selectedButton.getAttribute("aria-description")).toContain("200K token context window");
    expect(selectedButton.getAttribute("aria-description")).toContain(
      "Supports images, videos, pdf files",
    );
    expect(unselectedButton.getAttribute("aria-pressed")).toBe("false");
    expect(unselectedButton.querySelector("[data-selected-indicator]")).toBeNull();
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
            isEnabledForFavorites: true,
            resource: { status: "ready", catalog: bareCatalog },
          },
        ]}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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

  test("shows the context window without capability icons when attachment support is absent", async () => {
    const catalogWithoutSupport: AgentModelCatalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT Five",
          variants: [],
          contextWindow: 200_000,
        },
      ],
      defaultModelsByProvider: {},
    };
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: { status: "ready", catalog: catalogWithoutSupport },
          },
        ]}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.getByText("200K context")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("shows capability icons without a context window when the descriptor omits it", async () => {
    const catalogWithoutContext: AgentModelCatalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/gpt-5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5",
          modelName: "GPT Five",
          variants: [],
          attachmentSupport: {
            image: true,
            video: false,
            audio: false,
            pdf: false,
          },
        },
      ],
      defaultModelsByProvider: {},
    };
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: { status: "ready", catalog: catalogWithoutContext },
          },
        ]}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });

    expect(screen.queryByText(/context/)).toBeNull();
    expect(screen.getByRole("img", { name: "Supports images" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Supports videos" })).toBeNull();
  });

  test("single-clicking selects the model and keeps the popover open; double-clicking closes it", async () => {
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
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
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();

    await act(async () => {
      fireEvent.doubleClick(screen.getByText("GPT 5 Codex"));
    });
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
  });

  test("Space selects and stays open while Enter selects and closes", async () => {
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Codex runtime" }));
    });
    const codexRow = screen.getByRole("button", { name: "Select GPT 5 Codex model" });
    await act(async () => {
      codexRow.focus();
      fireEvent.keyDown(codexRow, { key: " " });
    });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(codexRow, { key: "Enter" });
    });
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
  });

  test("renders effort stepped slider for 2 to 7 levels and inline list fallback otherwise", async () => {
    const onSelectEffort = mock(() => {});
    const runtimes = makeRuntimes();
    const { rerender } = render(
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: {
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
            value: "medium",
            onSelect: onSelectEffort,
          },
        }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT 5 Codex/ }));
    });
    const slider = screen.getByRole("slider", { name: "Effort" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Medium");
    await act(async () => {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
    });
    expect(onSelectEffort).toHaveBeenCalledWith("high");

    rerender(
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: {
            options: [
              { value: "legacy", label: "legacy", disabled: true },
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
            value: "legacy",
            onSelect: onSelectEffort,
          },
        }}
        onValueChange={() => {}}
      />,
    );
    expect(screen.queryByRole("slider", { name: "Effort" })).toBeNull();
    const legacyBtn = screen.getByRole("button", { name: "legacy" });
    expect(legacyBtn.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Low" }));
    });
    expect(onSelectEffort).toHaveBeenCalledWith("low");
  });

  test("renders speed stepped slider, skips blocked stops, and falls back to list for unlisted speed", async () => {
    const onSelectSpeed = mock(() => {});
    const runtimes = makeRuntimes();
    const { rerender } = render(
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "s1",
              choice: "standard",
              levels: [
                { id: "fast", label: "Fast" },
                { id: "ultrafast", label: "Ultrafast" },
              ],
              blockedReason: undefined,
              pending: false,
              disabled: false,
              error: null,
              onChange: onSelectSpeed,
            },
          },
        }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT 5 Codex/ }));
    });
    const slider = screen.getByRole("slider", { name: "Speed" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Standard");
    await act(async () => {
      fireEvent.keyDown(slider, { key: "End" });
    });
    expect(onSelectSpeed).toHaveBeenCalledWith("ultrafast");

    rerender(
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "s1",
              choice: "standard",
              levels: [{ id: "fast", label: "Fast" }],
              blockedReason: "Fast mode requires an active plan.",
              pending: false,
              disabled: false,
              error: null,
              onChange: onSelectSpeed,
            },
          },
        }}
        onValueChange={() => {}}
      />,
    );
    expect(screen.getByText("Fast mode requires an active plan.")).toBeTruthy();
    onSelectSpeed.mockClear();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("slider", { name: "Speed" }), { key: "ArrowRight" });
    });
    expect(onSelectSpeed).not.toHaveBeenCalled();

    rerender(
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "s1",
              choice: "turbo",
              levels: [],
              blockedReason: undefined,
              pending: false,
              disabled: false,
              error: null,
              onChange: onSelectSpeed,
            },
          },
        }}
        onValueChange={() => {}}
      />,
    );
    expect(screen.queryByRole("slider", { name: "Speed" })).toBeNull();
    const speedGroup = screen.getByRole("group", { name: "Speed levels" });
    expect(within(speedGroup).getByRole("button", { name: /turbo/ }).hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => {
      fireEvent.click(within(speedGroup).getByRole("button", { name: "Standard" }));
    });
    expect(onSelectSpeed).toHaveBeenCalledWith("standard");
  });

  test("focuses speed slider in speed_only mode and keeps Retry clickable on catalog failure", async () => {
    const retry = mock(async () => {});
    const onSelectSpeed = mock(() => {});
    const codexReady: ModelPickerRuntime[] = [
      {
        descriptor: CODEX_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
        resource: resource("codex"),
      },
    ];
    const { rerender } = render(
      <ModelPicker
        runtimes={codexReady}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "speed_only",
          runtimeKind: "codex",
          reason: "Reuse keeps source model.",
        }}
        options={{
          effort: {
            options: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
            value: "high",
            onSelect: () => {},
          },
          speed: {
            control: {
              key: "s1",
              choice: "standard",
              levels: [{ id: "fast", label: "Fast" }],
              blockedReason: undefined,
              pending: false,
              disabled: false,
              error: null,
              onChange: onSelectSpeed,
            },
          },
        }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT 5 Codex/ }));
    });
    expect(screen.getByRole("textbox", { name: "Search models" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(document.activeElement).toBe(screen.getByRole("slider", { name: "Speed" }));

    rerender(
      <ModelPicker
        runtimes={[
          {
            descriptor: CODEX_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: {
              status: "failed",
              catalog: null,
              error: "Catalog load failed",
              retry,
            },
          },
        ]}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "speed_only",
          runtimeKind: "codex",
          reason: "Reuse keeps source model.",
        }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: { control: null },
        }}
        onValueChange={() => {}}
      />,
    );
    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    await act(async () => {
      fireEvent.click(retryButtons[0]!);
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("closedTriggerDisabledReason blocks opening when closed without closing an open popover", async () => {
    const runtimes = makeRuntimes();
    const { rerender } = render(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        closedTriggerDisabledReason="Saving model selection..."
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Select model, OpenCode, GPT Five/ });
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();

    rerender(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        closedTriggerDisabledReason={null}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, OpenCode, GPT Five/ }));
    });
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();

    rerender(
      <ModelPicker
        runtimes={runtimes}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        closedTriggerDisabledReason="Saving model selection..."
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();
  });

  test("renders composer trigger with icon-only non-standard speed and form trigger with speed label", () => {
    const speedControl = {
      key: "s1",
      choice: "fast",
      levels: [{ id: "fast", label: "Fast" }],
      blockedReason: undefined,
      pending: false,
      disabled: false,
      error: null,
      onChange: () => {},
    };
    const { rerender, container } = render(
      <ModelPicker
        triggerVariant="composer"
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: {
            options: [{ value: "high", label: "High" }],
            value: "high",
            onSelect: () => {},
          },
          speed: { control: speedControl },
        }}
        onValueChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="trigger-speed"]')?.textContent).toBe("");
    expect(container.querySelector('[data-speed-tone="fast"]')).toBeTruthy();

    rerender(
      <ModelPicker
        triggerVariant="form"
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: {
            options: [{ value: "high", label: "High" }],
            value: "high",
            onSelect: () => {},
          },
          speed: { control: speedControl },
        }}
        onValueChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="trigger-speed"]')?.textContent).toBe("Fast");
  });

  test("emits one callback across a browser double-click sequence and ignores active-row clicks", async () => {
    const onValueChange = mock(() => {});
    const twoModelCatalog: AgentModelCatalog = {
      ...catalog("opencode"),
      models: [
        ...catalog("opencode").models,
        {
          id: "proxy/sonnet",
          providerId: "proxy",
          providerName: "Anthropic Proxy",
          modelId: "sonnet",
          modelName: "Claude Sonnet",
          variants: [],
        },
      ],
    };
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: { status: "ready", catalog: twoModelCatalog },
          },
        ]}
        value={{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={onValueChange}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, OpenCode, GPT Five/ }));
    });

    // Clicking the already-selected row does not emit a write and keeps the popover open.
    const activeRow = screen.getByRole("button", { name: "Select GPT Five model" });
    await act(async () => {
      fireEvent.click(activeRow);
    });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();

    // Double-clicking the already-selected row closes without emitting a write.
    await act(async () => {
      fireEvent.click(activeRow);
      fireEvent.doubleClick(activeRow);
    });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();

    // Reopen and perform a full double-click sequence (click, click, dblclick) on an unselected row.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, OpenCode, GPT Five/ }));
    });
    const sonnetRow = screen.getByRole("button", { name: "Select Claude Sonnet model" });
    await act(async () => {
      fireEvent.click(sonnetRow);
      fireEvent.click(sonnetRow);
      fireEvent.doubleClick(sonnetRow);
    });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      providerId: "proxy",
      modelId: "sonnet",
    });
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
  });

  test("stacks the options pane below the rail and list when the popover container is narrow", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, OpenCode, GPT Five/ }));
    });

    const dialog = screen.getByRole("dialog");
    const optionsPane = screen.getByLabelText("Model options");
    const topGrid = optionsPane.previousElementSibling;
    expect(dialog.className).toContain("@container");
    expect(topGrid?.className).toContain("grid-cols-[3.5rem_minmax(0,1fr)]");
    expect(optionsPane.className).toContain("border-t");
  });

  test("omits redundant trigger tooltip when enabled and shows disabled reason when blocked", async () => {
    const { rerender } = render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: {
            options: [{ value: "high", label: "high" }],
            value: "high",
            onSelect: () => {},
          },
        }}
        onValueChange={() => {}}
      />,
    );
    const enabledTrigger = screen.getByRole("button", {
      name: "Select model, Codex, GPT 5 Codex",
    });
    expect(enabledTrigger.getAttribute("title")).toBe("");
    await act(async () => {
      fireEvent.pointerMove(enabledTrigger);
      fireEvent.focus(enabledTrigger);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "read_only", reason: "Session is read-only." }}
        options={defaultOptions}
        onValueChange={() => {}}
      />,
    );
    const blockedTrigger = screen.getByRole("button", {
      name: /Select model, Codex, GPT 5 Codex/,
    });
    await act(async () => {
      fireEvent.focus(blockedTrigger);
    });
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toContain("Session is read-only.");
    });
  });

  test("preserves keyboard focus in Reuse mode across catalog retry loading and settlement", async () => {
    const retry = mock(async () => {});
    const renderReuseState = (
      resource: ModelPickerRuntime["resource"],
      levels: { id: string; label: string }[] = [],
    ) => (
      <ModelPicker
        runtimes={[
          {
            descriptor: CODEX_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource,
          },
        ]}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "speed_only",
          runtimeKind: "codex",
          reason: "Reusing the existing session keeps its model.",
        }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "reuse-retry",
              choice: "standard",
              levels,
              blockedReason: undefined,
              pending: false,
              disabled: false,
              error: null,
              onChange: () => {},
            },
          },
        }}
        onValueChange={() => {}}
      />
    );

    const { rerender } = render(
      renderReuseState({
        status: "failed",
        catalog: null,
        error: "Catalog unavailable",
        retry,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, gpt-5/ }));
    });

    const speedRegion = screen.getByRole("region", { name: "Speed" });
    const retryButton = within(speedRegion).getByRole("button", { name: "Retry" });
    retryButton.focus();
    expect(document.activeElement).toBe(retryButton);

    await act(async () => {
      fireEvent.click(retryButton);
      rerender(renderReuseState({ status: "loading", catalog: null, retry }));
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(speedRegion);

    await act(async () => {
      rerender(
        renderReuseState({ status: "ready", catalog: catalog("codex") }, [
          { id: "priority", label: "Fast" },
        ]),
      );
    });
    expect(document.activeElement).toBe(screen.getByRole("slider", { name: "Speed" }));

    // A subsequent retry that fails again moves focus back to the Retry button.
    await act(async () => {
      rerender(renderReuseState({ status: "loading", catalog: null, retry }));
    });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Speed" }));
    await act(async () => {
      rerender(
        renderReuseState({
          status: "failed",
          catalog: null,
          error: "Still offline",
          retry,
        }),
      );
    });
    expect(document.activeElement).toBe(
      within(screen.getByRole("region", { name: "Speed" })).getByRole("button", { name: "Retry" }),
    );
  });

  test("preserves keyboard focus when Reuse speed switches between list and slider", async () => {
    const runtimes = makeRuntimes();
    let currentChoice = "turbo";
    const renderReusePicker = (choice: string, onChange: (next: string) => void) => (
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{
          kind: "speed_only",
          runtimeKind: "codex",
          reason: "Reusing the existing session keeps its model.",
        }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "reuse-1",
              choice,
              levels: [{ id: "priority", label: "Fast" }],
              blockedReason: undefined,
              pending: false,
              disabled: false,
              error: null,
              onChange,
            },
          },
        }}
        onValueChange={() => {}}
      />
    );

    const handleChange = (next: string) => {
      currentChoice = next;
    };
    const { rerender } = render(renderReusePicker(currentChoice, handleChange));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT 5 Codex/ }));
    });

    const speedGroup = screen.getByRole("group", { name: "Speed levels" });
    const standardButton = within(speedGroup).getByRole("button", { name: /Standard/ });
    standardButton.focus();
    expect(document.activeElement).toBe(standardButton);

    await act(async () => {
      fireEvent.click(standardButton);
      rerender(renderReusePicker(currentChoice, handleChange));
    });

    const speedSlider = screen.getByRole("slider", { name: "Speed" });
    expect(document.activeElement).toBe(speedSlider);

    // Switching back to an unlisted speed keeps focus on the replacement speed list control.
    await act(async () => {
      rerender(renderReusePicker("turbo", handleChange));
    });
    const replacedStandardButton = within(
      screen.getByRole("group", { name: "Speed levels" }),
    ).getByRole("button", { name: /Standard/ });
    expect(document.activeElement).toBe(replacedStandardButton);
  });

  test("moves focus to search when selecting Standard removes the last unlisted speed option", async () => {
    const runtimes = makeRuntimes();
    const renderPicker = (choice: string, pending: boolean, onChange: (next: string) => void) => (
      <ModelPicker
        runtimes={runtimes}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
        options={{
          effort: { options: [], value: undefined, onSelect: () => {} },
          speed: {
            control: {
              key: "clear-unlisted-speed",
              choice,
              levels: [],
              blockedReason: undefined,
              pending,
              disabled: false,
              error: null,
              onChange,
            },
          },
        }}
        onValueChange={() => {}}
      />
    );

    const onChange = mock((_next: string) => {});
    const { rerender } = render(renderPicker("turbo", false, onChange));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Select model, Codex, GPT 5 Codex/ }));
    });

    const speedGroup = screen.getByRole("group", { name: "Speed levels" });
    const standardButton = within(speedGroup).getByRole("button", { name: /Standard/ });
    standardButton.focus();
    expect(document.activeElement).toBe(standardButton);

    // Clicking Standard optimistically switches to Standard while pending, hiding the Speed section.
    await act(async () => {
      fireEvent.click(standardButton);
      rerender(renderPicker("standard", true, onChange));
    });
    expect(onChange).toHaveBeenCalledWith("standard");
    expect(screen.queryByRole("region", { name: "Speed" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search models" }));

    // Focus stays on search after the save settles.
    await act(async () => {
      rerender(renderPicker("standard", false, onChange));
    });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search models" }));
  });
});
