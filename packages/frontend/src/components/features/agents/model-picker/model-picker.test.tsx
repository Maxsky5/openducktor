import { describe, expect, mock, test } from "bun:test";
import {
  type AgentModelFavorite,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act, useState } from "react";
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

describe("ModelPicker", () => {
  test.each([
    {
      name: "Favorites when a favorite exists",
      favorites: [value],
      expectedView: "Favorite models",
      expectedModel: "Select GPT Five model",
    },
    {
      name: "the first runtime when there are no favorites",
      favorites: [],
      expectedView: "OpenCode runtime",
      expectedModel: "Select GPT Five model",
    },
  ])("opens $name on every opening", async ({ favorites, expectedView, expectedModel }) => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState({ favorites: [...favorites] })}
        selectionPolicy={{ kind: "editable" }}
        onValueChange={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Select model, Codex, GPT 5 Codex" });
    for (let opening = 0; opening < 2; opening += 1) {
      await act(async () => {
        fireEvent.click(trigger);
      });
      expect(screen.getByRole("button", { name: expectedView }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.getByRole("button", { name: expectedModel })).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Codex runtime" }));
        fireEvent.keyDown(screen.getByRole("button", { name: "Codex runtime" }), {
          key: "Escape",
        });
      });
    }
  });

  test("opens the available runtime when its only favorite belongs to a disabled runtime", async () => {
    const disabledRuntime = { ...makeRuntimes()[0]!, isEnabledForFavorites: false };
    render(
      <ModelPicker
        runtimes={[disabledRuntime, makeRuntimes()[1]!]}
        value={{ runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" }}
        favoriteState={favoriteState({ favorites: [value] })}
        selectionPolicy={{ kind: "editable" }}
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
        onValueChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Select model, OpenCode, GPT Five" })).toBeTruthy();
    expect(container.querySelector('svg[viewBox="0 0 512 512"]')).toBeTruthy();
  });

  test("resolves a saved canonical Claude ID to its label and selected alias row", async () => {
    render(
      <ModelPicker
        runtimes={[
          {
            descriptor: CLAUDE_RUNTIME_DESCRIPTOR,
            isEnabledForFavorites: true,
            resource: {
              status: "ready",
              catalog: {
                models: [
                  {
                    id: "sonnet",
                    providerId: "claude",
                    providerName: "Claude",
                    modelId: "sonnet",
                    resolvedModelId: "claude-sonnet-5-5",
                    modelName: "Sonnet 5.5",
                    variants: [],
                  },
                ],
                defaultModelsByProvider: {},
              },
            },
          },
        ]}
        value={{ runtimeKind: "claude", providerId: "claude", modelId: "claude-sonnet-5-5" }}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "runtime_locked", runtimeKind: "claude", reason: "" }}
        onValueChange={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select model, Claude, Sonnet 5.5" }));
    });
    expect(
      screen.getByRole("button", { name: "Select Sonnet 5.5 model" }).getAttribute("aria-pressed"),
    ).toBe("true");
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

  test("keeps cached models selectable while a refresh is in flight", async () => {
    const onValueChange = mock(() => {});
    const refreshingRuntimes: ModelPickerRuntime[] = [
      {
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        isEnabledForFavorites: true,
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
    expect(screen.getByRole("button", { name: "Select GPT Five model" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select GPT Five model" }));
    });
    expect(onValueChange).toHaveBeenCalledWith(value);
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
          runtimes={makeRuntimes()}
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
        isEnabledForFavorites: true,
        resource: {
          status: "failed",
          catalog: catalog("opencode"),
          error: "Catalog refetch failed",
          retry: async () => {},
        },
      },
      ...makeRuntimes().filter((runtime) => runtime.descriptor.kind === "codex"),
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
        runtimes={makeRuntimes()}
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

  test("marks the selected row with a paint-only accent bar", async () => {
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
        value={value}
        favoriteState={favoriteState()}
        selectionPolicy={{ kind: "editable" }}
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
    expect(selectedButton.querySelector(".absolute.bg-primary")).not.toBeNull();
    expect(selectedButton.getAttribute("aria-description")).toContain("200K token context window");
    expect(selectedButton.getAttribute("aria-description")).toContain(
      "Supports images, videos, pdf files",
    );
    expect(unselectedButton.getAttribute("aria-pressed")).toBe("false");
    expect(unselectedButton.querySelector(".bg-primary")).toBeNull();
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

  test("emits the exact pair and closes after model selection", async () => {
    const onValueChange = mock(() => {});
    render(
      <ModelPicker
        runtimes={makeRuntimes()}
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
