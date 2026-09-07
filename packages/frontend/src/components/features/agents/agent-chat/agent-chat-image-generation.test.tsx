import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  type AgentGeneratedImageReadInput,
  type AgentGeneratedImageReadResult,
  type AgentImageGenerationPart,
} from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  AgentOperationsContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { agentGeneratedImageQueryKeys } from "@/state/queries/agent-generated-images";
import { AgentChatImageGeneration } from "./agent-chat-image-generation";
import { AgentChatImageSessionContext } from "./agent-chat-image-session-context";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread",
};
const part: AgentImageGenerationPart = {
  kind: "image_generation",
  itemId: "image",
  messageId: "image",
  partId: "image",
  turnId: "turn",
  status: "completed",
  revisedPrompt: "A yellow duck",
  savedPath: "/runtime/duck.png",
  output: { itemId: "image", representation: "saved_file" },
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
const payload = (input: AgentGeneratedImageReadInput): AgentGeneratedImageReadResult => ({
  ...input,
  mime: "image/png",
  base64: png,
  byteLength: atob(png).length,
});
const images: HTMLImageElement[] = [];
const originalImage = globalThis.Image;
let createUrl: ReturnType<typeof spyOn<typeof URL, "createObjectURL">>;
let revokeUrl: ReturnType<typeof spyOn<typeof URL, "revokeObjectURL">>;
beforeEach(() => {
  images.length = 0;
  globalThis.Image = class extends originalImage {
    constructor() {
      super();
      images.push(this);
    }
  };
  let next = 0;
  createUrl = spyOn(URL, "createObjectURL").mockImplementation(() => `blob:image-${++next}`);
  revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.Image = originalImage;
  createUrl.mockRestore();
  revokeUrl.mockRestore();
});

const definitions = (supported: boolean): RuntimeDefinitionsContextValue => {
  const descriptor = {
    ...CODEX_RUNTIME_DESCRIPTOR,
    capabilities: {
      ...CODEX_RUNTIME_DESCRIPTOR.capabilities,
      optionalSurfaces: {
        ...CODEX_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
        supportsImageGeneration: supported,
      },
    },
  };
  return {
    runtimeDefinitions: [descriptor],
    availableRuntimeDefinitions: [descriptor],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [descriptor],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => {
      throw new Error("unexpected catalog read");
    },
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeSkills: async () => ({ skills: [] }),
    loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  };
};
const operations = (
  readGeneratedImage: AgentOperationsContextValue["readGeneratedImage"],
): AgentOperationsContextValue => ({
  readGeneratedImage,
  readSessionTodos: async () => [],
  readSessionHistory: async () => [],
  loadAgentSessionHistory: async () => null,
  loadAgentSessionContext: async () => {},
  startAgentSession: async () => {
    throw new Error("unexpected start");
  },
  sendAgentMessage: async () => {},
  stopAgentSession: async () => {},
  updateAgentSessionModel: () => {},
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
});
const harness = (
  read = mock(async (input: AgentGeneratedImageReadInput) => payload(input)),
  supported = true,
  initialPart = part,
) => {
  const client = new QueryClient();
  const runtimeDefinitions = definitions(supported);
  const actions = operations(read);
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitions}>
        <AgentOperationsContext.Provider value={actions}>
          {children}
        </AgentOperationsContext.Provider>
      </RuntimeDefinitionsContext.Provider>
    </QueryClientProvider>
  );
  const content = (sessionRef = ref, imagePart = part) => (
    <AgentChatImageSessionContext.Provider value={sessionRef}>
      <AgentChatImageGeneration part={imagePart} />
    </AgentChatImageSessionContext.Provider>
  );
  const view = render(content(ref, initialPart), { wrapper: Wrapper });
  return { client, read, view, content };
};
const loadImage = async (index = 0) => {
  await waitFor(() => expect(images.length).toBeGreaterThan(index));
  const image = images[index]!;
  Object.defineProperties(image, { naturalWidth: { value: 200 }, naturalHeight: { value: 100 } });
  await act(async () => {
    image.onload?.(new Event("load"));
  });
};

test("waits for PNG decode then shares one URL between thumbnail and accessible dialog", async () => {
  const { view, client } = harness();
  await waitFor(() => expect(images).toHaveLength(1));
  expect(screen.queryByRole("button", { name: "Open generated image preview" })).toBeNull();
  await loadImage();
  const trigger = screen.getByRole("button", { name: "Open generated image preview" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "Generated image" })).toBeTruthy();
  expect(
    screen.getAllByRole("img", { hidden: true }).map((image) => image.getAttribute("src")),
  ).toEqual(["blob:image-1", "blob:image-1"]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  view.unmount();
  expect(revokeUrl).toHaveBeenCalledWith("blob:image-1");
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({ queryKey: agentGeneratedImageQueryKeys.all }),
    ).toHaveLength(0),
  );
});

test("reveals the full prompt on request and keeps the preview header short", async () => {
  const revisedPrompt =
    "A detailed yellow duck beside a quiet lake with reeds and reflected morning light. ".repeat(
      60,
    );
  const { view } = harness(undefined, true, { ...part, revisedPrompt });
  expect(view.container.textContent).not.toContain(revisedPrompt);
  const promptButton = screen.getByRole("button", { name: "View prompt" });
  expect(promptButton.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(promptButton);
  expect(promptButton.getAttribute("aria-expanded")).toBe("true");
  expect(view.container.textContent).toContain(revisedPrompt);
  expect(screen.getByText(part.savedPath!)).toBeTruthy();
  fireEvent.click(promptButton);
  expect(view.container.textContent).not.toContain(revisedPrompt);
  await loadImage();
  const trigger = screen.getByRole("button", { name: "Open generated image preview" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Generated image" });
  expect(dialog.textContent).not.toContain(revisedPrompt);
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Preview of the generated image.",
  );
  expect(view.container.textContent).not.toContain(revisedPrompt);
  expect(dialog.querySelector("img")?.alt).toBe(revisedPrompt);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("truncated PNGs stay completed with a visible preview error", async () => {
  harness();
  await waitFor(() => expect(images).toHaveLength(1));
  await act(async () => {
    images[0]!.onerror?.(new Event("error"));
  });
  expect(screen.getByText("Image generated")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("PNG could not be displayed");
  expect(screen.queryByRole("button", { name: "Open generated image preview" })).toBeNull();
});

for (const field of ["externalSessionId", "repoPath"] as const) {
  test(`switching ${field} during a host read cannot show the old image`, async () => {
    let resolve!: (value: AgentGeneratedImageReadResult) => void;
    const pending = new Promise<AgentGeneratedImageReadResult>((done) => {
      resolve = done;
    });
    const read = mock((input: AgentGeneratedImageReadInput) =>
      input.ref[field] === ref[field] ? pending : Promise.resolve(payload(input)),
    );
    const { view, content } = harness(read);
    view.rerender(content({ ...ref, [field]: "other" }));
    await loadImage();
    const currentSrc = screen.getByRole("img").getAttribute("src");
    await act(async () => {
      resolve(payload({ ref, itemId: part.itemId, turnId: part.turnId }));
    });
    expect(images).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("src")).toBe(currentSrc);
  });
}

test("switching during decode revokes the old URL and ignores a captured stale callback", async () => {
  const { view, content } = harness();
  await waitFor(() => expect(images).toHaveLength(1));
  const staleLoad = images[0]!.onload!;
  view.rerender(content({ ...ref, externalSessionId: "other" }));
  expect(revokeUrl).toHaveBeenCalledWith("blob:image-1");
  await act(async () => {
    staleLoad.call(images[0]!, new Event("load"));
  });
  expect(screen.queryByRole("img")).toBeNull();
  await loadImage(1);
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:image-2");
});

test("unsupported runtime and completed output without a source never read bytes", () => {
  const first = harness(undefined, false);
  expect(first.read).not.toHaveBeenCalled();
  expect(screen.getByText("This runtime does not support image previews.")).toBeTruthy();
  first.view.unmount();
  const { output: _output, ...withoutOutput } = part;
  const second = harness(undefined, true, withoutOutput);
  expect(second.read).not.toHaveBeenCalled();
  expect(screen.getByText(/runtime did not report image output/)).toBeTruthy();
});

for (const status of ["running", "failed", "interrupted", "incomplete"] as const) {
  test(`renders ${status} separately from preview availability`, () => {
    const { output: _output, ...metadata } = part;
    render(<AgentChatImageGeneration part={{ ...metadata, status }} />);
    expect(screen.queryByText("Loading image preview…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open generated image preview" })).toBeNull();
  });
}

for (const resetsAtEpochSeconds of [undefined, 2000000000]) {
  test(`usage limits preserve the failure and supplied reset time ${resetsAtEpochSeconds}`, () => {
    const failure: NonNullable<AgentImageGenerationPart["failure"]> = {
      kind: "usage_limit",
      message: "Image generation quota reached.",
      limitId: "image_generation",
    };
    if (resetsAtEpochSeconds !== undefined) failure.resetsAtEpochSeconds = resetsAtEpochSeconds;
    const { output: _output, ...metadata } = part;
    const { read } = harness(undefined, true, { ...metadata, status: "failed", failure });
    expect(screen.getByText("Image generation limit reached")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(failure.message);
    expect(Boolean(screen.queryByText(/Wait until/))).toBe(resetsAtEpochSeconds !== undefined);
    expect(
      Boolean(
        screen.queryByText(
          "Check image-generation usage limits in the runtime before requesting another image.",
        ),
      ),
    ).toBe(resetsAtEpochSeconds === undefined);
    expect(read).not.toHaveBeenCalled();
  });
}

test("shows a generating placeholder without reading image bytes", () => {
  const { read, view } = harness(undefined, true, { ...part, status: "running" });
  expect(screen.getByRole("status").textContent).toBe("Generating image…");
  expect(view.container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  expect(screen.queryByText(part.revisedPrompt!)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test("closes prompt details when the session or image changes", () => {
  const { view, content } = harness(undefined, true, { ...part, status: "running" });
  const runningPart = { ...part, status: "running" as const };
  fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
  expect(screen.getByText(part.revisedPrompt!)).toBeTruthy();
  view.rerender(content({ ...ref, externalSessionId: "another-session" }, runningPart));
  expect(screen.queryByText(part.revisedPrompt!)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
  view.rerender(
    content(
      { ...ref, externalSessionId: "another-session" },
      { ...runningPart, itemId: "another-image" },
    ),
  );
  expect(screen.queryByText(part.revisedPrompt!)).toBeNull();
});

for (const transparentBackground of [true, false]) {
  test(`shows saved file and background ${transparentBackground} without opening the prompt`, () => {
    const { view } = harness(undefined, true, {
      ...part,
      status: "running",
      transparentBackground,
    });
    expect(screen.getByText(part.savedPath!)).toBeTruthy();
    expect(screen.getByText(transparentBackground ? "Transparent" : "Opaque")).toBeTruthy();
    expect(screen.queryByText(part.revisedPrompt!)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
    const prompt = view.container.querySelector('[data-slot="collapsible-content"]')!;
    expect(prompt.textContent).toContain(part.revisedPrompt!);
    expect(prompt.textContent).not.toContain(part.savedPath!);
    expect(prompt.textContent).not.toContain("Background");
  });
}

test("general failures preserve the reason and offer an action in the chat", () => {
  const failure = {
    kind: "generation_failed" as const,
    message: "The image service rejected the request.",
  };
  const { read } = harness(undefined, true, { ...part, status: "failed", failure });
  expect(screen.getByRole("alert").textContent).toContain(failure.message);
  expect(screen.getByRole("alert").textContent).toContain(
    "Ask the agent to explain this failure before trying again.",
  );
  expect(read).not.toHaveBeenCalled();
});

test("missing failure details state the limitation and an action", () => {
  harness(undefined, true, { ...part, status: "failed" });
  expect(screen.getByRole("alert").textContent).toContain("It did not provide a failure reason.");
  expect(screen.getByRole("alert").textContent).toContain(
    "Ask the agent to explain this failure before trying again.",
  );
});
