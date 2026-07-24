import { describe, expect, mock, test } from "bun:test";
import type { ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { resolveAgentStudioSendDraftParts } from "./agent-studio-send-draft";

const selectedModelDescriptor: AgentModelCatalog["models"][number] = {
  id: "openai/gpt-5",
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  variants: ["default"],
  contextWindow: 200_000,
  outputLimit: 8_192,
  attachmentSupport: {
    image: false,
    audio: false,
    video: false,
    pdf: true,
  },
};

const createPrompt = (): ReusablePrompt => ({
  id: "prompt-1",
  name: "review",
  description: "",
  content: "Review this",
});

const textDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

type ResolvePartsInput = Parameters<typeof resolveAgentStudioSendDraftParts>[0];

const resolveParts = (
  input: Omit<ResolvePartsInput, "supportsAttachments"> &
    Partial<Pick<ResolvePartsInput, "supportsAttachments">>,
) =>
  Promise.resolve(
    resolveAgentStudioSendDraftParts({
      supportsAttachments: true,
      ...input,
    }),
  );

describe("resolveAgentStudioSendDraftParts", () => {
  test("returns text message parts for a normal draft", async () => {
    await expect(
      resolveParts({
        draft: textDraft("hello"),
        reusablePrompts: [],
        selectedModelDescriptor,
      }),
    ).resolves.toEqual([{ kind: "text", text: "hello" }]);
  });

  test("returns null for empty drafts and invalid reusable prompt drafts", async () => {
    const prompt = createPrompt();
    await expect(
      resolveParts({
        draft: textDraft("   "),
        reusablePrompts: [prompt],
        selectedModelDescriptor,
      }),
    ).resolves.toBeNull();

    await expect(
      resolveParts({
        draft: {
          segments: [
            createTextSegment("before"),
            createSlashCommandSegment(toReusablePromptSlashCommand(prompt)),
          ],
          attachments: [],
        },
        reusablePrompts: [prompt],
        selectedModelDescriptor,
      }),
    ).resolves.toBeNull();
  });

  test("expands reusable prompt drafts", async () => {
    const prompt = createPrompt();
    await expect(
      resolveParts({
        draft: {
          segments: [createSlashCommandSegment(toReusablePromptSlashCommand(prompt))],
          attachments: [],
        },
        reusablePrompts: [prompt],
        selectedModelDescriptor,
      }),
    ).resolves.toEqual([{ kind: "text", text: "Review this" }]);
  });

  test("rejects unsupported attachments before staging", async () => {
    const stageAttachment = mock(async () => "/tmp/image.png");
    await expect(
      resolveParts({
        draft: {
          segments: [createTextSegment("look")],
          attachments: [
            createComposerAttachment(
              {
                name: "image.png",
                kind: "image",
                mime: "image/png",
                path: "/tmp/image.png",
              },
              "attachment-1",
            ),
          ],
        },
        reusablePrompts: [],
        selectedModelDescriptor,
        stageAttachment,
      }),
    ).resolves.toBeNull();
    expect(stageAttachment).not.toHaveBeenCalled();
  });

  test("rejects attachments when the runtime cannot encode them", async () => {
    const stageAttachment = mock(async () => "/tmp/brief.pdf");
    await expect(
      resolveParts({
        draft: {
          segments: [createTextSegment("review")],
          attachments: [
            createComposerAttachment(
              {
                name: "brief.pdf",
                kind: "pdf",
                mime: "application/pdf",
                path: "/tmp/brief.pdf",
              },
              "attachment-1",
            ),
          ],
        },
        reusablePrompts: [],
        selectedModelDescriptor,
        supportsAttachments: false,
        stageAttachment,
      }),
    ).resolves.toBeNull();
    expect(stageAttachment).not.toHaveBeenCalled();
  });

  test("stages supported attachments", async () => {
    const stageAttachment = mock(async () => "/tmp/brief.pdf");
    await expect(
      resolveParts({
        draft: {
          segments: [createTextSegment("review")],
          attachments: [
            createComposerAttachment(
              {
                name: "brief.pdf",
                kind: "pdf",
                mime: "application/pdf",
                file: new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
              },
              "attachment-1",
            ),
          ],
        },
        reusablePrompts: [],
        selectedModelDescriptor,
        stageAttachment,
      }),
    ).resolves.toEqual([
      { kind: "text", text: "review" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "pdf",
          mime: "application/pdf",
          name: "brief.pdf",
          path: "/tmp/brief.pdf",
        },
      },
    ]);
    expect(stageAttachment).toHaveBeenCalledTimes(1);
  });
});
