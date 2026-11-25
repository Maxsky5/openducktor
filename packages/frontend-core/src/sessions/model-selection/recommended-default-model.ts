import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelDescriptor } from "@openducktor/core";
import type { RuntimeModelCatalogQueryResource } from "../../queries/use-runtime-model-catalogs";

export type RecommendedDefaultModelSelection = {
  runtimeKind: RuntimeKind;
  providerId: string;
  modelId: string;
  variant: string;
  profileId: string;
};

const PRIORITY_RUNTIMES: readonly RuntimeKind[] = ["claude", "codex", "antigravity"];
const PREFERRED_EFFORT = "high";

const parseNumericParts = (raw: string): number[] =>
  raw
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value));

const compareVersionTuples = (left: readonly number[], right: readonly number[]): number => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};

const extractDateStamp = (text: string): number => {
  const match = text.match(/(?:^|[-_\s])(20\d{6})(?:$|[-_\s])/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
};

const extractVersionAfter = (text: string, pattern: RegExp): number[] => {
  const match = text.match(pattern);
  if (!match?.[1]) return [];
  return parseNumericParts(match[1]);
};

const hasAlias = (model: AgentModelDescriptor, alias: string): boolean =>
  model.aliases?.some((candidate) => candidate.toLowerCase() === alias) ?? false;

const supportsPreferredEffort = (model: AgentModelDescriptor): boolean =>
  model.variants.includes(PREFERRED_EFFORT);

const pickBestCandidate = <T extends AgentModelDescriptor>(
  candidates: readonly T[],
  compare: (left: T, right: T) => number,
): T | null => {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!best || compare(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best;
};

const extractClaudeOpusVersion = (model: AgentModelDescriptor): number[] => {
  // Match major.minor right after "opus" and ignore 8-digit release dates like 20260601.
  const idVersion = extractVersionAfter(
    model.modelId,
    /\bopus[-_\s]+(\d{1,3}(?:[.-]\d{1,3}(?!\d))?)(?!\d)/i,
  );
  if (idVersion.length > 0) return idVersion;
  return extractVersionAfter(
    model.modelName,
    /\bopus[-_\s]+(\d{1,3}(?:[.-]\d{1,3}(?!\d))?)(?!\d)/i,
  );
};

const pickLatestClaudeOpus = (catalog: AgentModelCatalog): AgentModelDescriptor | null => {
  const candidates = catalog.models.filter(
    (model) =>
      hasAlias(model, "opus") ||
      /\bopus\b/i.test(model.modelId) ||
      /\bopus\b/i.test(model.modelName),
  );
  return pickBestCandidate(candidates, (left, right) => {
    const versionDiff = compareVersionTuples(
      extractClaudeOpusVersion(left),
      extractClaudeOpusVersion(right),
    );
    if (versionDiff !== 0) return versionDiff;
    const aliasDiff = Number(hasAlias(left, "opus")) - Number(hasAlias(right, "opus"));
    if (aliasDiff !== 0) return aliasDiff;
    const effortDiff =
      Number(supportsPreferredEffort(left)) - Number(supportsPreferredEffort(right));
    if (effortDiff !== 0) return effortDiff;
    return extractDateStamp(left.modelId) - extractDateStamp(right.modelId);
  });
};

const GPT_SOL_PATTERN = /\bgpt[-_\s]*(\d{1,3}(?:[.-]\d{1,3}(?!\d))*)[-_\s]*sol(?=$|[-_\s])/i;
const SUB_VARIANT_PATTERN = /(?:^|[-_\s])(mini|nano|spark|lite)(?:$|[-_\s])/i;

const isBaseCodexSol = (model: AgentModelDescriptor): boolean =>
  !SUB_VARIANT_PATTERN.test(model.modelId) && !SUB_VARIANT_PATTERN.test(model.modelName);

const extractGptSolVersion = (model: AgentModelDescriptor): number[] => {
  const idVersion = extractVersionAfter(model.modelId, GPT_SOL_PATTERN);
  if (idVersion.length > 0) return idVersion;
  return extractVersionAfter(model.modelName, GPT_SOL_PATTERN);
};

const pickLatestCodexGptSol = (catalog: AgentModelCatalog): AgentModelDescriptor | null => {
  const candidates = catalog.models.filter(
    (model) => GPT_SOL_PATTERN.test(model.modelId) || GPT_SOL_PATTERN.test(model.modelName),
  );
  return pickBestCandidate(candidates, (left, right) => {
    const baseDiff = Number(isBaseCodexSol(left)) - Number(isBaseCodexSol(right));
    if (baseDiff !== 0) return baseDiff;
    const versionDiff = compareVersionTuples(
      extractGptSolVersion(left),
      extractGptSolVersion(right),
    );
    if (versionDiff !== 0) return versionDiff;
    return Number(supportsPreferredEffort(left)) - Number(supportsPreferredEffort(right));
  });
};

const GEMINI_NEON_PATTERN = /\bgemini\b.*\bneon\b/i;
const GEMINI_FLASH_PATTERN = /\bgemini\b.*\bflash\b/i;
const GEMINI_VERSION_PATTERN = /\bgemini[-_\s]*(\d{1,3}(?:[.-]\d{1,3}(?!\d))*)(?!\d)/i;

const extractGeminiVersion = (model: AgentModelDescriptor): number[] => {
  const idVersion = extractVersionAfter(model.modelId, GEMINI_VERSION_PATTERN);
  if (idVersion.length > 0) return idVersion;
  return extractVersionAfter(model.modelName, GEMINI_VERSION_PATTERN);
};

const isNonLiteGemini = (model: AgentModelDescriptor): boolean =>
  !SUB_VARIANT_PATTERN.test(model.modelId) && !SUB_VARIANT_PATTERN.test(model.modelName);

const pickAntigravityRecommendedModel = (
  catalog: AgentModelCatalog,
): AgentModelDescriptor | null => {
  const neonCandidates = catalog.models.filter(
    (model) => GEMINI_NEON_PATTERN.test(model.modelId) || GEMINI_NEON_PATTERN.test(model.modelName),
  );
  if (neonCandidates.length > 0) {
    return pickBestCandidate(neonCandidates, (left, right) => {
      const versionDiff = compareVersionTuples(
        extractGeminiVersion(left),
        extractGeminiVersion(right),
      );
      if (versionDiff !== 0) return versionDiff;
      const effortDiff =
        Number(supportsPreferredEffort(left)) - Number(supportsPreferredEffort(right));
      if (effortDiff !== 0) return effortDiff;
      return Number(left.variants.length > 0) - Number(right.variants.length > 0);
    });
  }

  const flashCandidates = catalog.models.filter(
    (model) =>
      GEMINI_FLASH_PATTERN.test(model.modelId) || GEMINI_FLASH_PATTERN.test(model.modelName),
  );
  return pickBestCandidate(flashCandidates, (left, right) => {
    const nonLiteDiff = Number(isNonLiteGemini(left)) - Number(isNonLiteGemini(right));
    if (nonLiteDiff !== 0) return nonLiteDiff;
    const versionDiff = compareVersionTuples(
      extractGeminiVersion(left),
      extractGeminiVersion(right),
    );
    if (versionDiff !== 0) return versionDiff;
    const effortDiff =
      Number(supportsPreferredEffort(left)) - Number(supportsPreferredEffort(right));
    if (effortDiff !== 0) return effortDiff;
    return Number(left.variants.length > 0) - Number(right.variants.length > 0);
  });
};

const pickRecommendedModelForRuntime = (
  runtimeKind: RuntimeKind,
  catalog: AgentModelCatalog,
): AgentModelDescriptor | null => {
  if (runtimeKind === "claude") return pickLatestClaudeOpus(catalog);
  if (runtimeKind === "codex") return pickLatestCodexGptSol(catalog);
  if (runtimeKind === "antigravity") return pickAntigravityRecommendedModel(catalog);
  return null;
};

/**
 * Resolves the recommended workspace default model from enabled runtimes in priority order:
 * 1. Claude: latest Opus in `high` effort.
 * 2. Codex: latest GPT X Sol in `high` effort.
 * 3. Antigravity: Gemini Neon in `high` effort, falling back to latest Gemini Flash in `high` effort.
 *
 * Waits (returns `null`) while a higher-priority enabled runtime is still loading its catalog so
 * the UI does not flash a lower-priority proposal before the preferred runtime finishes loading.
 */
export const resolveRecommendedDefaultModel = ({
  runtimeDefinitions,
  catalogResources,
}: {
  runtimeDefinitions: readonly RuntimeDescriptor[];
  catalogResources: readonly RuntimeModelCatalogQueryResource[];
}): RecommendedDefaultModelSelection | null => {
  const descriptorsByKind = new Map(
    runtimeDefinitions.map((descriptor) => [descriptor.kind, descriptor]),
  );
  const resourcesByKind = new Map(
    catalogResources.map((resource) => [resource.runtimeKind, resource]),
  );

  for (const runtimeKind of PRIORITY_RUNTIMES) {
    const descriptor = descriptorsByKind.get(runtimeKind);
    if (!descriptor) continue;
    const resource = resourcesByKind.get(runtimeKind);
    if (!resource || !resource.isEnabled) continue;
    if (resource.isLoading && !resource.catalog) return null;
    if (!resource.catalog) continue;

    const model = pickRecommendedModelForRuntime(runtimeKind, resource.catalog);
    if (!model) continue;

    const variant = supportsPreferredEffort(model) ? PREFERRED_EFFORT : (model.variants[0] ?? "");
    return {
      runtimeKind,
      providerId: model.providerId,
      modelId: model.modelId,
      variant,
      profileId: "",
    };
  }
  return null;
};
