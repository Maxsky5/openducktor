import { describe, expect, mock, test } from "bun:test";
import { LOCAL_ATTACHMENT_BYTE_LIMIT, type ReusablePrompt } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createFileReferenceSegment,
  createSlashCommandSegment,
  createTextSegment,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { toReusablePromptSlashCommand } from "@/components/features/agents/agent-chat/agent-chat-reusable-prompts";
import { resolveAgentChatSendDraftParts } from "@/features/agent-chat-composer/message-delivery/agent-chat-send-draft";

const modelDescriptor: AgentModelCatalog["models"][number] = {
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

type ResolvePartsInput = Parameters<typeof resolveAgentChatSendDraftParts>[0];

const resolveParts = async (
  input: Omit<ResolvePartsInput, "supportsAttachments"> &
    Partial<Pick<ResolvePartsInput, "supportsAttachments">>,
) =>
  resolveAgentChatSendDraftParts({
    supportsAttachments: true,
    ...input,
  });

describe("resolveAgentChatSendDraftParts", () => {
  test("returns text message parts for a normal draft", async () => {
    await expect(
      resolveParts({
        draft: textDraft("hello"),
        reusablePrompts: [],
        modelDescriptor,
      }),
    ).resolves.toEqual([{ kind: "text", text: "hello" }]);
  });

  const command = { id: "review", trigger: "review", title: "review", hints: ["review"] };
  const file = { id: "file-src-main", path: "src/main.ts", name: "main.ts", kind: "code" as const };
  test.each([
    {
      name: "slash command",
      segment: createSlashCommandSegment(command),
      part: { kind: "slash_command", command },
    },
    {
      name: "file reference",
      segment: createFileReferenceSegment(file),
      part: { kind: "file_reference", file },
    },
  ])("returns the part of a draft that has only a $name", async ({ segment, part }) => {
    const draft = {
      segments: [createTextSegment(""), segment, createTextSegment("")],
      attachments: [],
    };
    await expect(resolveParts({ draft, reusablePrompts: [], modelDescriptor })).resolves.toEqual([
      part,
    ]);
  });

  test("returns null for empty drafts", async () => {
    await expect(
      resolveParts({
        draft: textDraft("   "),
        reusablePrompts: [],
        modelDescriptor,
      }),
    ).resolves.toBeNull();
  });

  test("reports invalid reusable prompt drafts", async () => {
    const prompt = createPrompt();
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
        modelDescriptor,
      }),
    ).rejects.toThrow("Reusable prompt slash commands must be the first message item.");
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
        modelDescriptor,
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
        modelDescriptor,
        stageAttachment,
      }),
    ).resolves.toBeNull();
    expect(stageAttachment).not.toHaveBeenCalled();
  });

  test("rejects oversized attachments before staging", async () => {
    const stageAttachment = mock(async () => "/tmp/brief.pdf");
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: LOCAL_ATTACHMENT_BYTE_LIMIT + 1 });

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
                file,
              },
              "attachment-1",
            ),
          ],
        },
        reusablePrompts: [],
        modelDescriptor,
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
        modelDescriptor,
        supportsAttachments: false,
        stageAttachment,
      }),
    ).resolves.toBeNull();
    expect(stageAttachment).not.toHaveBeenCalled();
  });

  test("sends a path-backed attachment with its own path", async () => {
    const attachment = {
      name: "brief.pdf",
      kind: "pdf" as const,
      mime: "application/pdf",
      path: "/tmp/brief.pdf",
    };
    await expect(
      resolveParts({
        draft: {
          segments: [createTextSegment("review")],
          attachments: [createComposerAttachment(attachment, "pdf-1")],
        },
        reusablePrompts: [],
        modelDescriptor,
      }),
    ).resolves.toEqual([
      { kind: "text", text: "review" },
      { kind: "attachment", attachment: { id: "pdf-1", ...attachment } },
    ]);
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
        modelDescriptor,
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
