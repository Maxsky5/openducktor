import {
  type CodexAppServerSkillRecord,
  type CodexAppServerSkillsListResponse,
  skillCatalogSchema,
} from "@openducktor/contracts";
import type { AgentSkillCatalog } from "@openducktor/core";

const readOptionalString = (value: string | null | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const requireString = (value: string | null | undefined, fieldName: string): string => {
  const trimmed = readOptionalString(value);
  if (!trimmed) {
    throw new Error(`Invalid Codex skill payload: missing ${fieldName}.`);
  }
  return trimmed;
};

const isEnabled = (value: boolean | null | undefined): boolean => value ?? true;

const compareSkillsByName = (
  left: Pick<AgentSkillCatalog["skills"][number], "displayName" | "name" | "title">,
  right: Pick<AgentSkillCatalog["skills"][number], "displayName" | "name" | "title">,
): number => {
  const leftLabel = left.displayName ?? left.title ?? left.name;
  const rightLabel = right.displayName ?? right.title ?? right.name;
  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
};

const toAgentSkillCatalogEntry = (
  record: CodexAppServerSkillRecord,
): AgentSkillCatalog["skills"][number] | null => {
  if (!isEnabled(record.enabled)) {
    return null;
  }

  const name = requireString(record.name, "name");
  const path = requireString(record.path, "path");
  return {
    id: path,
    name,
    path,
    title: readOptionalString(record.title),
    displayName: readOptionalString(record.displayName),
    description: readOptionalString(record.description),
  };
};

export const toCodexSkillCatalog = (
  response: CodexAppServerSkillsListResponse,
): AgentSkillCatalog => {
  const skills = response.data.flatMap((catalog) =>
    catalog.skills.flatMap((record) => {
      const skill = toAgentSkillCatalogEntry(record);
      return skill ? [skill] : [];
    }),
  );

  return skillCatalogSchema.parse({ skills: [...skills].sort(compareSkillsByName) });
};
