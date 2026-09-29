// Sample model catalogs for the settings replicas. The model and provider names are fictional.
// The Claude runtime lists "Default (recommended)" first, as the product does.

export type RuntimeKind = "opencode" | "codex" | "claude";
type Capability = "image" | "pdf";

type Model = {
  id: string;
  name: string;
  provider: string;
  capabilities: Capability[];
  context?: string;
};

/** The order of the runtime rail in the model picker. */
export const RUNTIMES: RuntimeKind[] = ["opencode", "codex", "claude"];

/** The models that the picker lists for each runtime. */
export type Catalogs = { [Kind in RuntimeKind]: Model[] };

export const CATALOGS: Catalogs = {
  opencode: [
    {
      id: "vega-2-pro",
      name: "Vega 2 Pro",
      provider: "Vega",
      capabilities: ["image"],
      context: "1M",
    },
    {
      id: "vega-2-flash",
      name: "Vega 2 Flash",
      provider: "Vega",
      capabilities: ["image"],
      context: "1M",
    },
    {
      id: "kestrel-5",
      name: "Kestrel 5",
      provider: "Kestrel AI",
      capabilities: ["image", "pdf"],
      context: "400K",
    },
    {
      id: "qubit-coder-32b",
      name: "Qubit Coder 32B",
      provider: "Local",
      capabilities: [],
      context: "128K",
    },
  ],
  codex: [
    {
      id: "gpt-6-astra",
      name: "GPT-6-Astra",
      provider: "OpenAI",
      capabilities: ["image"],
      context: "400K",
    },
    {
      id: "gpt-6-astra-mini",
      name: "GPT-6-Astra Mini",
      provider: "OpenAI",
      capabilities: ["image"],
      context: "400K",
    },
    {
      id: "gpt-6-nova",
      name: "GPT-6-Nova",
      provider: "OpenAI",
      capabilities: ["image"],
      context: "272K",
    },
  ],
  claude: [
    {
      id: "default",
      name: "Default (recommended)",
      provider: "Claude",
      capabilities: ["image", "pdf"],
    },
    { id: "claude-lyra-3", name: "Lyra 3", provider: "Claude", capabilities: ["image", "pdf"] },
    { id: "claude-wren-3", name: "Wren 3", provider: "Claude", capabilities: ["image", "pdf"] },
    { id: "claude-finch-2", name: "Finch 2", provider: "Claude", capabilities: ["image", "pdf"] },
  ],
};

/** A model of the catalog of a runtime. */
export type ModelRef = { runtime: RuntimeKind; model: string };

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

/** The provider and the name of a model, as a session signature shows them: openai/GPT-6-Astra. */
export function modelPath(ref: ModelRef): string {
  const model = modelOf(ref);
  return `${model.provider.toLowerCase()}/${model.name}`;
}

export type RoleDefault = ModelRef & {
  role: "spec" | "planner" | "build" | "qa";
  label: string;
  profile?: string;
  variant: string;
};

/** The per-role defaults after the scene: each role can use another runtime. */
export const ROLE_DEFAULTS: RoleDefault[] = [
  { role: "spec", label: "Spec", runtime: "claude", model: "claude-lyra-3", variant: "high" },
  { role: "planner", label: "Planner", runtime: "codex", model: "gpt-6-astra", variant: "high" },
  { role: "build", label: "Builder", runtime: "codex", model: "gpt-6-astra", variant: "medium" },
  {
    role: "qa",
    label: "QA",
    runtime: "opencode",
    model: "vega-2-pro",
    profile: "build",
    variant: "high",
  },
];

/** The Spec default before the scene changes it. */
export const SPEC_BEFORE: ModelRef = { runtime: "codex", model: "gpt-6-astra" };

/** The Spec default that the visitor chooses in the scene. */
export const SPEC_AFTER: ModelRef = { runtime: "claude", model: "claude-lyra-3" };
