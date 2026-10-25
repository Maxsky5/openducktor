import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSubagentReference,
} from "@openducktor/core";

export type ReferenceMenuItem =
  | {
      kind: "subagent";
      id: string;
      subagent: AgentSubagentReference;
    }
  | {
      kind: "file";
      id: string;
      result: AgentFileSearchResult;
    };

/** The slash commands whose trigger contains the query, in catalog order. */
export const filterSlashCommands = (
  commands: AgentSlashCommand[],
  query: string,
): AgentSlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) => command.trigger.toLowerCase().includes(normalizedQuery));
};

/** The skills that match the query by name or title, sorted by their label. */
export const filterSkills = (
  skills: AgentSkillReference[],
  query: string,
): AgentSkillReference[] => {
  const normalizedQuery = query.trim().toLowerCase();
  const sortedSkills = skills.toSorted((left, right) => {
    const leftLabel = left.displayName ?? left.title ?? left.name;
    const rightLabel = right.displayName ?? right.title ?? right.name;
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  });
  if (normalizedQuery.length === 0) {
    return sortedSkills;
  }

  return sortedSkills.filter((skill) =>
    [skill.name, skill.title, skill.displayName]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
};

/** The subagents that match the query by name, label, or description, sorted by label. */
export const filterSubagents = (
  subagents: AgentSubagentReference[],
  query: string,
): AgentSubagentReference[] => {
  const normalizedQuery = query.trim().toLowerCase();
  const sortedSubagents = subagents.toSorted((left, right) => {
    const leftLabel = left.label ?? left.name;
    const rightLabel = right.label ?? right.name;
    return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  });
  if (normalizedQuery.length === 0) {
    return sortedSubagents;
  }

  return sortedSubagents.filter((subagent) =>
    [subagent.name, subagent.label, subagent.description]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
};

/** The names that rank a reference: the name and label of a subagent, the name and path of a file. */
const referenceNames = (item: ReferenceMenuItem): (string | undefined)[] =>
  item.kind === "subagent"
    ? [item.subagent.name, item.subagent.label]
    : [item.result.name, item.result.path];

/** 0 when a name equals the query, 1 when a name starts with it, 2 for any other match. */
const referenceMatchRank = (item: ReferenceMenuItem, query: string): number => {
  const names = referenceNames(item)
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  if (names.includes(query)) return 0;
  if (names.some((name) => name.startsWith(query))) return 1;
  return 2;
};

/**
 * The `@` menu: the references whose name equals the query, then those whose name starts with it,
 * then the other matches, such as a match in a subagent description. In each rank, subagents come
 * before the file search results, in their own order.
 */
export const buildReferenceMenuItems = (
  subagents: AgentSubagentReference[],
  fileResults: AgentFileSearchResult[],
  query: string,
): ReferenceMenuItem[] => {
  const items: ReferenceMenuItem[] = [
    ...subagents.map((subagent) => ({
      kind: "subagent" as const,
      id: `subagent:${subagent.id}`,
      subagent,
    })),
    ...fileResults.map((result) => ({
      kind: "file" as const,
      id: `file:${result.id}`,
      result,
    })),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return items;
  // The sort is stable, so each rank keeps the order above.
  return items.toSorted(
    (left, right) =>
      referenceMatchRank(left, normalizedQuery) - referenceMatchRank(right, normalizedQuery),
  );
};
