import { describe, expect, test } from "bun:test";
import type {
  AgentFileSearchResult,
  AgentSkillReference,
  AgentSlashCommand,
  AgentSubagentReference,
} from "@openducktor/core";
import {
  buildReferenceMenuItems,
  filterSkills,
  filterSlashCommands,
  filterSubagents,
} from "./composer-autocomplete-filters";

const command = (trigger: string): AgentSlashCommand => ({
  id: trigger,
  trigger,
  title: trigger,
  source: "command",
  hints: [],
});

const skill = (name: string, displayName?: string): AgentSkillReference =>
  displayName
    ? { id: name, name, path: `/skills/${name}`, displayName }
    : { id: name, name, path: `/skills/${name}` };

const subagent = (name: string, label?: string, description?: string): AgentSubagentReference => {
  const reference: AgentSubagentReference = { id: name, name };
  if (label) reference.label = label;
  if (description) reference.description = description;
  return reference;
};

const file = (path: string): AgentFileSearchResult => ({
  id: path,
  path,
  name: path.split("/").at(-1) ?? path,
  kind: "default",
});

describe("composer autocomplete filters", () => {
  test("keeps slash commands in catalog order and matches the trigger", () => {
    const commands = [command("review"), command("compact"), command("preview")];

    expect(filterSlashCommands(commands, "")).toEqual(commands);
    expect(filterSlashCommands(commands, " VIEW ").map((entry) => entry.trigger)).toEqual([
      "review",
      "preview",
    ]);
  });

  test("sorts skills by label and matches name, title, or display name", () => {
    const skills = [skill("zeta"), skill("alpha", "Beta skill")];

    expect(filterSkills(skills, "").map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
    expect(filterSkills(skills, "beta").map((entry) => entry.name)).toEqual(["alpha"]);
  });

  test("sorts subagents by label and lists them before files", () => {
    const subagents = filterSubagents([subagent("worker", "Worker"), subagent("analyst")], "");

    expect(subagents.map((entry) => entry.name)).toEqual(["analyst", "worker"]);
    expect(
      buildReferenceMenuItems(
        subagents,
        [{ id: "src/a.ts", path: "src/a.ts", name: "a.ts", kind: "code" }],
        "",
      ).map((item) => item.id),
    ).toEqual(["subagent:analyst", "subagent:worker", "file:src/a.ts"]);
  });

  test("ranks an exact name, then a name prefix, before other matches", () => {
    const subagents = filterSubagents(
      [
        subagent("explore", "Explore", "Reads the repository"),
        subagent("general", "General", "Reads and writes files"),
        subagent("reader", "Reader"),
      ],
      "READ",
    );
    const files = [file("docs/thread.md"), file("README.md"), file("read")];

    expect(buildReferenceMenuItems(subagents, files, "READ").map((item) => item.id)).toEqual([
      "file:read",
      "subagent:reader",
      "file:README.md",
      "subagent:explore",
      "subagent:general",
      "file:docs/thread.md",
    ]);
  });
});
