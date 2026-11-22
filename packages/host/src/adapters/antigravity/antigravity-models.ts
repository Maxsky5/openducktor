import { execFile } from "node:child_process";
import {
  ANTIGRAVITY_RUNTIME_DESCRIPTOR,
  type AgentModelCatalog,
  type AgentModelDescriptor,
} from "@openducktor/contracts";

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
const ANTIGRAVITY_PROVIDER_NAME = "Antigravity";

/**
 * The levels of `agy --effort`. `agy models` names a model with thinking levels once for each
 * level, with the level as the last segment of the ID and the name.
 */
const THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);
const MODELS_TIMEOUT_MS = 30_000;

type AntigravityModelLine = { readonly id: string; readonly name: string };

/** Reads the `id<TAB>name` lines of `agy models`. A line without both fields fails the read. */
const parseAntigravityModelLines = (stdout: string): AntigravityModelLine[] =>
  stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [id, name, ...rest] = line.split("\t").map((field) => field.trim());
      if (!id || !name || rest.length > 0) {
        throw new Error(
          `Antigravity listed a model in an unknown format: '${line}'. ${ANTIGRAVITY_RUNTIME_DESCRIPTOR.updateAction}`,
        );
      }
      return { id, name };
    });

const splitThinkingLevel = (
  line: AntigravityModelLine,
): { readonly baseId: string; readonly level: string } | null => {
  const separator = line.id.lastIndexOf("-");
  if (separator <= 0) return null;
  const level = line.id.slice(separator + 1);
  return THINKING_LEVEL_SET.has(level) ? { baseId: line.id.slice(0, separator), level } : null;
};

const nameWithoutLevel = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, "").trim();

const toModel = (modelId: string, modelName: string, variants: string[]): AgentModelDescriptor => ({
  id: `${ANTIGRAVITY_PROVIDER_ID}/${modelId}`,
  providerId: ANTIGRAVITY_PROVIDER_ID,
  providerName: ANTIGRAVITY_PROVIDER_NAME,
  modelId,
  modelName,
  variants,
  // The agent reads attachments with its own file tool.
  attachmentSupport: { image: true, audio: false, video: false, pdf: true },
});

/**
 * Groups the lines into models with thinking levels as variants. Lines whose IDs differ only in a
 * last `-<level>` segment form one model when there are at least two of them. Every other line
 * is one model without variants. This is the only place that reads Antigravity model IDs.
 */
const groupAntigravityModels = (lines: AntigravityModelLine[]): AgentModelDescriptor[] => {
  const linesByBaseId = new Map<string, AntigravityModelLine[]>();
  for (const line of lines) {
    const split = splitThinkingLevel(line);
    if (!split) continue;
    linesByBaseId.set(split.baseId, [...(linesByBaseId.get(split.baseId) ?? []), line]);
  }
  const models: AgentModelDescriptor[] = [];
  const grouped = new Set<string>();
  for (const line of lines) {
    const split = splitThinkingLevel(line);
    const group = split ? linesByBaseId.get(split.baseId) : undefined;
    if (!split || !group || group.length < 2) {
      models.push(toModel(line.id, line.name, []));
      continue;
    }
    if (grouped.has(split.baseId)) continue;
    grouped.add(split.baseId);
    const levels = group.flatMap((entry) => splitThinkingLevel(entry)?.level ?? []);
    const variants = THINKING_LEVELS.filter((level) => levels.includes(level));
    models.push(toModel(split.baseId, nameWithoutLevel(line.name), variants));
  }
  return models;
};

export const toAntigravityModelCatalog = (stdout: string): AgentModelCatalog => {
  // The account decides the models: ACP offers the same list to the session.
  const models = groupAntigravityModels(parseAntigravityModelLines(stdout));
  if (models.length === 0) {
    throw new Error(
      "Antigravity listed no models. Sign in with the Antigravity CLI, check your account, then try again.",
    );
  }
  return {
    runtime: ANTIGRAVITY_RUNTIME_DESCRIPTOR,
    models,
    defaultModelsByProvider: {},
  };
};

/** Runs `agy models` with the effective executable path. It starts no ACP process. */
export const readAntigravityModelCatalog = ({
  executablePath,
  env,
  cwd,
}: {
  executablePath: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<AgentModelCatalog> =>
  new Promise((resolve, reject) => {
    execFile(
      executablePath,
      ["models"],
      { cwd, env, timeout: MODELS_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`Antigravity could not list models: ${detail}`, { cause: error }));
          return;
        }
        try {
          resolve(toAntigravityModelCatalog(stdout));
        } catch (cause) {
          reject(cause);
        }
      },
    );
  });
