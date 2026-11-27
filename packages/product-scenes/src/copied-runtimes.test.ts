import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EffortTrack, SHOULDER } from "./replicas/models/EffortTrack";
import { CATALOGS, RUNTIME_LABELS, RUNTIMES, type RuntimeKind } from "./sample/models";
import { SPEC_PICKED } from "./scenes/runtimes/sample";
import { importProduct, readProductWords } from "./test-support/product-source";

type Capabilities = {
  speed: { support: string };
  optionalSurfaces: { supportsProfiles: boolean; supportsVariants: boolean };
};
type CatalogModel = {
  modelId: string;
  modelName: string;
  providerName: string;
  variants: string[];
};
type Catalog = { models: CatalogModel[] };

// SAFETY: runtime-descriptors.ts exports the descriptor of each runtime, and a missing export
// fails the test.
const { RUNTIME_DESCRIPTORS_BY_KIND } = await importProduct<{
  RUNTIME_DESCRIPTORS_BY_KIND: Record<RuntimeKind, { label: string; capabilities: Capabilities }>;
}>("packages/contracts/src/runtime-descriptors.ts");
// SAFETY: antigravity-models.ts exports the parser of `agy models`.
const { toAntigravityModelCatalog } = await importProduct<{
  toAntigravityModelCatalog: (stdout: string) => Catalog;
}>("packages/host/src/adapters/antigravity/antigravity-models.ts");
// SAFETY: model-selection-state.ts exports the selection of a model change.
const { resolveModelSelectionForModelChange } = await importProduct<{
  resolveModelSelectionForModelChange: (input: {
    catalog: Catalog;
    currentSelection: null;
    modelKey: string;
    runtimeKind: RuntimeKind;
    preferredVariant: string;
    preferredSpeed: undefined;
  }) => { variant?: string } | null;
}>("packages/core/src/services/model-selection-state.ts");
// SAFETY: step-track-geometry.ts exports the geometry of the effort slider.
const geometry = await importProduct<{
  shellPath: (cx: number, open: number, plateau: number, track: number) => string;
  plateauFor: (textWidth: number) => number;
  tickHeight: (index: number, count: number) => number;
}>("packages/frontend/src/components/features/agents/model-picker/step-track-geometry.ts");

const PICKER = "packages/frontend/src/components/features/agents/model-picker";
const DEFAULTS = "packages/frontend/src/components/features/repository/model-defaults";

/** The `agy models` lines of the sample catalog: one line for each thinking level of a model. */
function agyModels(): string {
  return CATALOGS.antigravity
    .flatMap((model) =>
      model.variants.length === 0
        ? [`${model.id}\t${model.name}`]
        : model.variants.map((level) => `${model.id}-${level}\t${model.name} (${level})`),
    )
    .join("\n");
}

describe("the copied model picker", () => {
  test("the rail lists the four runtimes with the labels of their descriptors", () => {
    expect<string[]>(RUNTIMES).toEqual(Object.keys(RUNTIME_DESCRIPTORS_BY_KIND));
    for (const kind of RUNTIMES)
      expect<string>(RUNTIME_LABELS[kind]).toBe(RUNTIME_DESCRIPTORS_BY_KIND[kind].label);
  });

  test("only OpenCode has profiles, and Antigravity has effort and no speed", () => {
    const capabilities = (kind: RuntimeKind): Capabilities =>
      RUNTIME_DESCRIPTORS_BY_KIND[kind].capabilities;
    expect(RUNTIMES.filter((kind) => capabilities(kind).optionalSurfaces.supportsProfiles)).toEqual(
      ["opencode"],
    );
    expect(capabilities("antigravity").optionalSurfaces.supportsVariants).toBe(true);
    expect(capabilities("antigravity").speed.support).toBe("none");
    expect(capabilities("codex").speed.support).not.toBe("none");
  });

  test("Antigravity groups the thinking levels of a model as its effort", () => {
    const catalog = toAntigravityModelCatalog(agyModels());
    expect(
      catalog.models.map(({ modelId, modelName, providerName, variants }) => ({
        modelId,
        modelName,
        providerName,
        variants,
      })),
    ).toEqual(
      CATALOGS.antigravity.map((model) => ({
        modelId: model.id,
        modelName: model.name,
        providerName: model.provider,
        variants: model.variants,
      })),
    );
    const picked = resolveModelSelectionForModelChange({
      catalog,
      currentSelection: null,
      modelKey: `antigravity/${SPEC_PICKED.model}`,
      runtimeKind: "antigravity",
      preferredVariant: SPEC_PICKED.effort,
      preferredSpeed: undefined,
    });
    expect(picked?.variant).toBe(SPEC_PICKED.effort);
  });

  test("the words of the picker and of the role defaults come from the product", async () => {
    const picker = await readProductWords([
      `${PICKER}/model-picker.tsx`,
      `${PICKER}/model-picker-options-pane.tsx`,
    ]);
    for (const words of ['"Search models..."', "Effort </span>", "Profile </span>"])
      expect(picker).toContain(words);
    expect(picker).toContain('{ from: "#006aff", to: "#0059d4"');
    const defaults = await readProductWords([`${DEFAULTS}/repository-model-defaults-fields.tsx`]);
    expect(defaults).toContain('"Agent defaults by role"');
    expect(defaults).toContain('"Override the workspace default for specific roles."');
    const start = await readProductWords([
      "packages/frontend/src/components/features/agents/session-start-modal.tsx",
    ]);
    expect(start).toContain(">Runtime and model<");
  });

  test("the effort slider draws the shoulder and the ticks of the product", () => {
    // The product shell over a track of 400 pixels, with a flat top of 40 pixels at x = 200.
    const shell = geometry.shellPath(200, 1, 40, 400);
    const points = (SHOULDER.match(/[\d.]+/g) ?? []).map(Number);
    const moved: string[] = [];
    for (let index = 2; index < points.length; index += 2) {
      moved.push(
        `${((points[index] ?? 0) + 160).toFixed(2)} ${(points[index + 1] ?? 0).toFixed(2)}`,
      );
    }
    const [c1, c2, p1, c3, c4, p3] = moved;
    expect(shell).toContain(`H160.00C${c1} ${c2} ${p1}C${c3} ${c4} ${p3}`);
    expect(geometry.plateauFor(30) - 30).toBe(4);
    const markup = renderToStaticMarkup(
      createElement(EffortTrack, {
        stops: ["low", "medium", "high", "xhigh", "max"],
        value: "high",
      }),
    );
    const heights = [...markup.matchAll(/--h:([\d.]+)/g)].map((match) => Number(match[1]));
    expect(heights).toEqual([0, 1, 2, 3, 4].map((index) => geometry.tickHeight(index, 5)));
  });
});
