import { skillCatalogSchema } from "@openducktor/contracts";
import type { AgentSkillCatalog } from "@openducktor/core";
import { isPlainObject } from "./codex-app-server-shared";
import type { CodexSkillsListResponse } from "./types";

const readOptionalString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid Codex skill payload: ${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const requireString = (value: unknown, fieldName: string): string => {
  const trimmed = readOptionalString(value, fieldName);
  if (!trimmed) {
    throw new Error(`Invalid Codex skill payload: missing ${fieldName}.`);
  }
  return trimmed;
};

const readEnabled = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "boolean") {
    throw new Error("Invalid Codex skill payload: enabled must be a boolean.");
  }
  return value;
};

const compareSkillsByName = (
  left: { displayName: string | undefined; name: string; title: string | undefined },
  right: { displayName: string | undefined; name: string; title: string | undefined },
): number => {
  const leftLabel = left.displayName ?? left.title ?? left.name;
  const rightLabel = right.displayName ?? right.title ?? right.name;
  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
};

export const toCodexSkillCatalog = (response: unknown): AgentSkillCatalog => {
  if (!isPlainObject(response) || !Array.isArray(response.data)) {
    throw new Error("Invalid Codex skills/list payload: expected an object with data array.");
  }

  const catalogs = (response as CodexSkillsListResponse).data as unknown[];
  const skills = catalogs.flatMap((catalog, catalogIndex) => {
    if (!isPlainObject(catalog)) {
      throw new Error(
        `Invalid Codex skills/list payload at catalog index ${catalogIndex}: expected object.`,
      );
    }
    requireString(catalog.cwd, "cwd");
    if (!Array.isArray(catalog.skills)) {
      throw new Error(
        `Invalid Codex skills/list payload at catalog index ${catalogIndex}: missing skills array.`,
      );
    }

    return catalog.skills.flatMap((record, skillIndex) => {
      if (!isPlainObject(record)) {
        throw new Error(
          `Invalid Codex skill payload at catalog index ${catalogIndex}, skill index ${skillIndex}: expected object.`,
        );
      }
      if (!readEnabled(record.enabled)) {
        return [];
      }

      const name = requireString(record.name, "name");
      const path = requireString(record.path, "path");
      return [
        {
          id: path,
          name,
          path,
          title: readOptionalString(record.title, "title"),
          displayName: readOptionalString(record.displayName, "displayName"),
          description: readOptionalString(record.description, "description"),
        },
      ];
    });
  });

  return skillCatalogSchema.parse({ skills: [...skills].sort(compareSkillsByName) });
};
