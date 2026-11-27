// Sample model catalogs for the model picker replicas. The model and provider names are fictional.
// The Claude runtime lists "Default (recommended)" first, as the product does. Antigravity lists
// the thinking levels of a model as its effort, as antigravity-models.ts groups them. Each runtime
// lists four models, so the picker keeps its height when the rail shows another runtime.

export type RuntimeKind = "opencode" | "codex" | "claude" | "antigravity";
type Capability = "image" | "pdf";

type Model = {
  id: string;
  name: string;
  provider: string;
  capabilities: Capability[];
  context?: string;
  /** The effort levels of the model, in the order of the effort track. */
  variants: string[];
};

/** The order of the runtime rail in the model picker: the order of RUNTIME_DESCRIPTORS_BY_KIND. */
export const RUNTIMES: RuntimeKind[] = ["opencode", "codex", "claude", "antigravity"];

/** The label of each runtime: the `label` of its descriptor in runtime-descriptors.ts. */
export const RUNTIME_LABELS = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
} as const satisfies Record<RuntimeKind, string>;

/** The models that the picker lists for each runtime. */
export type Catalogs = { [Kind in RuntimeKind]: Model[] };

const LOW_TO_HIGH = ["low", "medium", "high"];
const LOW_TO_XHIGH = ["low", "medium", "high", "xhigh"];

export const CATALOGS: Catalogs = {
  opencode: [
    {
      id: "vega-2-pro",
      name: "Vega 2 Pro",
      provider: "Vega",
      capabilities: ["image"],
      context: "1M",
      variants: LOW_TO_HIGH,
    },
    {
      id: "vega-2-flash",
      name: "Vega 2 Flash",
      provider: "Vega",
      capabilities: ["image"],
      context: "1M",
      variants: LOW_TO_HIGH,
    },
    {
      id: "kestrel-5",
      name: "Kestrel 5",
      provider: "Kestrel AI",
      capabilities: ["image", "pdf"],
      context: "400K",
      variants: LOW_TO_HIGH,
    },
    {
      id: "qubit-coder-32b",
      name: "Qubit Coder 32B",
      provider: "Local",
      capabilities: [],
      context: "128K",
      variants: [],
    },
  ],
  codex: [
    {
      id: "gpt-6-astra",
      name: "GPT-6-Astra",
      provider: "Codex",
      capabilities: ["image"],
      context: "400K",
      variants: LOW_TO_XHIGH,
    },
    {
      id: "gpt-6-astra-mini",
      name: "GPT-6-Astra Mini",
      provider: "Codex",
      capabilities: ["image"],
      context: "400K",
      variants: LOW_TO_XHIGH,
    },
    {
      id: "gpt-6-nova",
      name: "GPT-6-Nova",
      provider: "Codex",
      capabilities: ["image"],
      context: "272K",
      variants: LOW_TO_XHIGH,
    },
    {
      id: "gpt-6-nova-mini",
      name: "GPT-6-Nova Mini",
      provider: "Codex",
      capabilities: ["image"],
      context: "272K",
      variants: LOW_TO_XHIGH,
    },
  ],
  claude: [
    {
      id: "default",
      name: "Default (recommended)",
      provider: "Claude",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
    {
      id: "claude-lyra-3",
      name: "Lyra 3",
      provider: "Claude",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
    {
      id: "claude-wren-3",
      name: "Wren 3",
      provider: "Claude",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
    {
      id: "claude-finch-2",
      name: "Finch 2",
      provider: "Claude",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
  ],
  // An Antigravity model has no context window in its catalog, and it reads images and PDF files.
  antigravity: [
    {
      id: "gemini-4-comet",
      name: "Gemini 4 Comet",
      provider: "Antigravity",
      capabilities: ["image", "pdf"],
      variants: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "gemini-4-comet-flash",
      name: "Gemini 4 Comet Flash",
      provider: "Antigravity",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
    {
      id: "orbit-4-pro",
      name: "Orbit 4 Pro",
      provider: "Antigravity",
      capabilities: ["image", "pdf"],
      variants: [],
    },
    {
      id: "orbit-oss-120b",
      name: "Orbit OSS 120B",
      provider: "Antigravity",
      capabilities: ["image", "pdf"],
      variants: LOW_TO_HIGH,
    },
  ],
};

/** A model of the catalog of a runtime. */
export type ModelRef = { runtime: RuntimeKind; model: string };

/** The speed of a model that offers more than Standard. */
export type Speed = "standard" | "fast";

/**
 * The choice of a model picker: a model of a runtime, its effort, the agent profile of OpenCode,
 * and the speed of a model that has speed levels.
 */
export type ModelChoice = ModelRef & {
  effort: string;
  profile?: string | undefined;
  speed?: Speed | undefined;
};

/** The key of a model row in the picker, such as codex:gpt-6-astra. */
export function modelKey(ref: ModelRef): string {
  return `${ref.runtime}:${ref.model}`;
}

function modelOf(ref: ModelRef): Model {
  const model = CATALOGS[ref.runtime].find((item) => item.id === ref.model);
  if (!model) throw new Error(`The ${ref.runtime} catalog has no model ${ref.model}.`);
  return model;
}

/** The display name of a model, such as GPT-6-Astra. */
export function modelName(ref: ModelRef): string {
  return modelOf(ref).name;
}

/** The effort levels of a model, in the order of the effort track. */
export function modelEfforts(ref: ModelRef): readonly string[] {
  return modelOf(ref).variants;
}

/** The provider and the name of a model, as a session signature shows them: codex/GPT-6-Astra. */
export function modelPath(ref: ModelRef): string {
  const model = modelOf(ref);
  return `${model.provider.toLowerCase()}/${model.name}`;
}
