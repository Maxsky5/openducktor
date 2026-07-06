import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTextSegment } from "./agent-chat-composer-draft";
import { buildFileSearchResult } from "./agent-chat-test-fixtures";
import { useAgentChatComposerEditorAutocomplete } from "./use-agent-chat-composer-editor-autocomplete";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const slashCommands = [
  {
    id: "compact",
    trigger: "compact",
    title: "Compact",
    description: "Compact the current session",
    hints: ["compact"],
  },
  {
    id: "continue",
    trigger: "continue",
    title: "Continue",
    description: "Continue the current work",
    hints: ["continue"],
  },
];

const skills = [
  {
    id: "/skills/review/SKILL.md",
    name: "review",
    path: "/skills/review/SKILL.md",
    title: "Review",
    description: "Review code",
  },
  {
    id: "/skills/refactor/SKILL.md",
    name: "refactor",
    path: "/skills/refactor/SKILL.md",
    title: "Refactor",
    description: "Improve structure",
  },
];

const subagents = [
  {
    id: "reviewer",
    name: "reviewer",
    label: "Reviewer",
    description: "Review code",
  },
  {
    id: "docs",
    name: "docs",
    label: "Docs",
    description: "Update docs",
  },
];

type AutocompleteProps = Parameters<typeof useAgentChatComposerEditorAutocomplete>[0];

const createAutocompleteProps = (
  searchFiles: (query: string) => Promise<ReturnType<typeof buildFileSearchResult>[]>,
  options: Partial<
    Pick<
      AutocompleteProps,
      | "disabled"
      | "supportsSlashCommands"
      | "supportsFileSearch"
      | "supportsSkillReferences"
      | "supportsSubagentReferences"
    >
  > & {
    skills?: typeof skills;
    subagents?: typeof subagents;
  } = {},
): AutocompleteProps => ({
  disabled: options.disabled ?? false,
  supportsSlashCommands: options.supportsSlashCommands ?? true,
  supportsFileSearch: options.supportsFileSearch ?? true,
  supportsSkillReferences: options.supportsSkillReferences ?? false,
  supportsSubagentReferences: options.supportsSubagentReferences ?? false,
  slashCommands: [...slashCommands],
  skills: options.skills ? [...options.skills] : [],
  subagents: options.subagents ? [...options.subagents] : [],
  searchFiles,
});

const createHarness = (
  searchFiles: (query: string) => Promise<ReturnType<typeof buildFileSearchResult>[]>,
  options: Parameters<typeof createAutocompleteProps>[1] = {},
) => {
  return createHookHarness(
    useAgentChatComposerEditorAutocomplete,
    createAutocompleteProps(searchFiles, options),
  );
};

const buildDraft = (text: string, segmentId = "segment-1") => ({
  segments: [createTextSegment(text, segmentId)],
  attachments: [],
});

const createDeferred = <Value,>() => {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
};

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe("useAgentChatComposerEditorAutocomplete", () => {
  test("filters slash commands from the current selection target", async () => {
    const searchFiles = mock(async () => []);
    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("/comp"), {
        segmentId: "segment-1",
        offset: 5,
      });
    });

    const latest = harness.getLatest();
    expect(latest.showSlashMenu).toBe(true);
    expect(latest.filteredSlashCommands.map((command) => command.trigger)).toEqual(["compact"]);
    expect(latest.showReferenceMenu).toBe(false);

    await harness.unmount();
  });

  test("filters skills from dollar trigger only when skill references are supported", async () => {
    const searchFiles = mock(async () => []);
    const harness = createHarness(searchFiles, {
      supportsSkillReferences: true,
      skills,
    });
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("use $rev"), {
        segmentId: "segment-1",
        offset: 8,
      });
    });

    expect(harness.getLatest().showSkillMenu).toBe(true);
    expect(harness.getLatest().filteredSkills.map((skill) => skill.name)).toEqual(["review"]);

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("use $rev"), {
        segmentId: "segment-1",
        offset: 8,
      });
    });

    expect(harness.getLatest().filteredSkills.map((skill) => skill.name)).toEqual(["review"]);

    await harness.unmount();

    const unsupportedHarness = createHarness(searchFiles, {
      supportsSkillReferences: false,
      skills,
    });
    await unsupportedHarness.mount();

    await unsupportedHarness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("use $rev"), {
        segmentId: "segment-1",
        offset: 8,
      });
    });

    expect(unsupportedHarness.getLatest().showSkillMenu).toBe(false);
    expect(unsupportedHarness.getLatest().filteredSkills).toEqual([]);

    await unsupportedHarness.unmount();
  });

  test("does not restore stale slash menu after slash support returns", async () => {
    const searchFiles = mock(async () => []);
    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("/comp"), {
        segmentId: "segment-1",
        offset: 5,
      });
    });

    expect(harness.getLatest().showSlashMenu).toBe(true);

    await harness.update(
      createAutocompleteProps(searchFiles, {
        supportsSlashCommands: false,
      }),
    );

    expect(harness.getLatest().slashMenuState).toBeNull();
    expect(harness.getLatest().showSlashMenu).toBe(false);

    await harness.update(createAutocompleteProps(searchFiles));

    expect(harness.getLatest().slashMenuState).toBeNull();
    expect(harness.getLatest().showSlashMenu).toBe(false);

    await harness.unmount();
  });

  test("keeps previous file results while a newer search is pending", async () => {
    const firstSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const secondSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const searchFiles = mock((query: string) => {
      return query === "a" ? firstSearch.promise : secondSearch.promise;
    });

    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@a"), {
        segmentId: "segment-1",
        offset: 2,
      });
    });

    firstSearch.resolve([buildFileSearchResult({ path: "src/alpha.ts", name: "alpha.ts" })]);
    await harness.waitFor((state) => {
      return state.fileSearchResults.some((result) => result.path === "src/alpha.ts");
    });

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@ab"), {
        segmentId: "segment-1",
        offset: 3,
      });
    });

    const loadingState = harness.getLatest();
    expect(loadingState.showReferenceMenu).toBe(true);
    expect(loadingState.isFileSearchLoading).toBe(false);
    expect(loadingState.fileSearchResults.map((result) => result.path)).toEqual(["src/alpha.ts"]);

    secondSearch.resolve([buildFileSearchResult({ path: "src/ab.ts", name: "ab.ts" })]);
    await harness.waitFor((state) => {
      return state.fileSearchResults.some((result) => result.path === "src/ab.ts");
    });

    expect(harness.getLatest().fileSearchResults.map((result) => result.path)).toEqual([
      "src/ab.ts",
    ]);

    await harness.unmount();
  });

  test("shows file search loading only after the pending search exceeds the delay", async () => {
    const slowSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const searchFiles = mock(() => slowSearch.promise);
    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@slow"), {
        segmentId: "segment-1",
        offset: 5,
      });
    });

    expect(harness.getLatest().showReferenceMenu).toBe(true);
    expect(harness.getLatest().isFileSearchLoading).toBe(false);

    await harness.run(async () => {
      await wait(550);
    });

    expect(harness.getLatest().isFileSearchLoading).toBe(true);

    slowSearch.resolve([buildFileSearchResult({ path: "src/slow.ts", name: "slow.ts" })]);
    await harness.waitFor((state) => state.isFileSearchLoading === false);

    expect(harness.getLatest().fileSearchResults.map((result) => result.path)).toEqual([
      "src/slow.ts",
    ]);

    await harness.unmount();
  });

  test("filters subagents from the file reference trigger", async () => {
    const searchFiles = mock(async () => [buildFileSearchResult()]);
    const harness = createHarness(searchFiles, {
      supportsSubagentReferences: true,
      subagents,
    });
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@rev"), {
        segmentId: "segment-1",
        offset: 4,
      });
    });

    await harness.waitFor((state) => state.isFileSearchLoading === false);

    expect(harness.getLatest().showReferenceMenu).toBe(true);
    expect(harness.getLatest().filteredSubagents.map((subagent) => subagent.name)).toEqual([
      "reviewer",
    ]);
    expect(harness.getLatest().referenceMenuItems.map((item) => item.kind)).toEqual([
      "subagent",
      "file",
    ]);
    expect(searchFiles).toHaveBeenCalledWith("rev");

    await harness.unmount();
  });

  test("opens the @ menu for subagents without searching files when file search is unsupported", async () => {
    const searchFiles = mock(async () => [buildFileSearchResult()]);
    const harness = createHarness(searchFiles, {
      supportsFileSearch: false,
      supportsSubagentReferences: true,
      subagents,
    });
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@doc"), {
        segmentId: "segment-1",
        offset: 4,
      });
    });

    expect(harness.getLatest().showReferenceMenu).toBe(true);
    expect(harness.getLatest().isFileSearchLoading).toBe(false);
    expect(harness.getLatest().filteredSubagents.map((subagent) => subagent.name)).toEqual([
      "docs",
    ]);
    expect(searchFiles).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("ignores stale file search responses after a newer query", async () => {
    const firstSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const secondSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const searchFiles = mock((query: string) => {
      return query === "a" ? firstSearch.promise : secondSearch.promise;
    });

    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@a"), {
        segmentId: "segment-1",
        offset: 2,
      });
    });

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@ab"), {
        segmentId: "segment-1",
        offset: 3,
      });
    });

    secondSearch.resolve([buildFileSearchResult({ path: "src/ab.ts", name: "ab.ts" })]);
    await harness.waitFor((state) => {
      return state.fileSearchResults.some((result) => result.path === "src/ab.ts");
    });

    firstSearch.resolve([buildFileSearchResult({ path: "src/alpha.ts", name: "alpha.ts" })]);
    await harness.waitFor((state) => state.isFileSearchLoading === false);

    expect(harness.getLatest().fileSearchResults.map((result) => result.path)).toEqual([
      "src/ab.ts",
    ]);

    await harness.unmount();
  });

  test("ignores stale file search responses after file search support is disabled", async () => {
    const fileSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const searchFiles = mock(() => fileSearch.promise);
    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@a"), {
        segmentId: "segment-1",
        offset: 2,
      });
    });

    expect(harness.getLatest().showReferenceMenu).toBe(true);
    expect(harness.getLatest().isFileSearchLoading).toBe(false);

    await harness.update(
      createAutocompleteProps(searchFiles, {
        supportsFileSearch: false,
      }),
    );

    expect(harness.getLatest().referenceMenuState).toBeNull();
    expect(harness.getLatest().showReferenceMenu).toBe(false);
    expect(harness.getLatest().isFileSearchLoading).toBe(false);

    await harness.run(() => {
      fileSearch.resolve([buildFileSearchResult({ path: "src/alpha.ts", name: "alpha.ts" })]);
    });

    await harness.update(createAutocompleteProps(searchFiles));

    expect(harness.getLatest().referenceMenuState).toBeNull();
    expect(harness.getLatest().showReferenceMenu).toBe(false);
    expect(harness.getLatest().fileSearchResults).toEqual([]);

    await harness.unmount();
  });

  test("does not repeat the same file search request for an unchanged trigger", async () => {
    const firstSearch = createDeferred<ReturnType<typeof buildFileSearchResult>[]>();
    const searchFiles = mock(() => firstSearch.promise);

    const harness = createHarness(searchFiles);
    await harness.mount();

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@ab"), {
        segmentId: "segment-1",
        offset: 3,
      });
    });

    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().isFileSearchLoading).toBe(false);

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@ab"), {
        segmentId: "segment-1",
        offset: 3,
      });
    });

    expect(searchFiles).toHaveBeenCalledTimes(1);

    firstSearch.resolve([buildFileSearchResult({ path: "src/ab.ts", name: "ab.ts" })]);
    await harness.waitFor((state) => {
      return state.fileSearchResults.some((result) => result.path === "src/ab.ts");
    });

    await harness.run((state) => {
      state.syncMenusForSelectionTarget(buildDraft("@ab"), {
        segmentId: "segment-1",
        offset: 3,
      });
    });

    expect(searchFiles).toHaveBeenCalledTimes(1);

    await harness.unmount();
  });
});
