import { describe, expect, test } from "bun:test";
import type { AgentSkillReference, AgentUserMessageDisplayPart } from "@openducktor/core";
import { createSessionMessagesState } from "../agent-orchestrator/support/messages";
import type { AgentChatMessage } from "../../types/agent-orchestrator";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { withClaudeSkillMentions } from "./claude-skill-mentions";

const GRILL_SKILL: AgentSkillReference = {
  id: "grill-me",
  name: "grill-me",
  path: "grill-me",
  title: "grill-me",
  description: "Grill a plan",
};

const GITNEXUS_SKILL: AgentSkillReference = {
  id: "gitnexus:generate_map (MCP)",
  name: "gitnexus:generate_map (MCP)",
  path: "gitnexus:generate_map (MCP)",
  title: "Generate architecture map",
};

const userMessage = (
  content: string,
  parts: AgentUserMessageDisplayPart[] = [{ kind: "text", text: content }],
): AgentChatMessage => ({
  id: "user-1",
  role: "user",
  content,
  timestamp: "2026-07-27T10:00:00.000Z",
  meta: {
    kind: "user",
    state: "read",
    parts,
  },
});

const threadSession = (
  message: AgentChatMessage,
  runtimeKind: AgentChatTranscriptSession["runtimeKind"] = "claude",
): AgentChatTranscriptSession => ({
  externalSessionId: "session-1",
  runtimeKind,
  workingDirectory: "/repo",
  activityState: "idle",
  runtimeStatusMessage: null,
  pendingQuestions: [],
  messages: createSessionMessagesState("session-1", [message], 4),
});

describe("withClaudeSkillMentions", () => {
  test("projects catalog-backed Claude skill commands as source-mapped chips", () => {
    const session = threadSession(userMessage("/grill-me"));
    const projected = withClaudeSkillMentions(session, [GRILL_SKILL]);

    expect(projected.messages.items[0]?.meta).toMatchObject({
      kind: "user",
      parts: [
        { kind: "text", text: "/grill-me" },
        {
          kind: "skill_mention",
          skill: GRILL_SKILL,
          sourceText: {
            value: "/grill-me",
            start: 0,
            end: 9,
          },
        },
      ],
    });
    expect(projected.messages.version).not.toBe(session.messages.version);
  });

  test("keeps the projected message object and revision when the session projects again", () => {
    const session = threadSession(userMessage("/grill-me"));
    const skills = [GRILL_SKILL];
    const first = withClaudeSkillMentions(session, skills);
    const again = withClaudeSkillMentions({ ...session }, skills);

    expect(again.messages.items[0]).toBe(first.messages.items[0]);
    expect(again.messages.version).toBe(first.messages.version);
  });

  test("matches the complete catalog name when a skill name contains spaces", () => {
    const projected = withClaudeSkillMentions(
      threadSession(userMessage("/gitnexus:generate_map (MCP)")),
      [GITNEXUS_SKILL],
    );

    expect(projected.messages.items[0]?.meta).toMatchObject({
      kind: "user",
      parts: [
        { kind: "text", text: "/gitnexus:generate_map (MCP)" },
        {
          kind: "skill_mention",
          skill: GITNEXUS_SKILL,
          sourceText: {
            value: "/gitnexus:generate_map (MCP)",
            start: 0,
            end: 28,
          },
        },
      ],
    });
  });

  test("leaves existing live skill parts and non-Claude messages unchanged", () => {
    const livePart: AgentUserMessageDisplayPart = {
      kind: "skill_mention",
      skill: GRILL_SKILL,
      sourceText: {
        value: "/grill-me",
        start: 0,
        end: 9,
      },
    };
    const liveSession = threadSession(userMessage("/grill-me", [livePart]));
    const opencodeSession = threadSession(userMessage("/grill-me"), "opencode");

    expect(withClaudeSkillMentions(liveSession, [GRILL_SKILL])).toBe(liveSession);
    expect(withClaudeSkillMentions(opencodeSession, [GRILL_SKILL])).toBe(opencodeSession);
  });

  test("does not reinterpret native commands or email addresses as skills", () => {
    const session = threadSession(userMessage("Run /help and contact dev@example.com"));

    expect(withClaudeSkillMentions(session, [GRILL_SKILL])).toBe(session);
  });

  test("does not add skill mentions inside structured file references", () => {
    const content = '@"docs /grill-me"';
    const session = threadSession(
      userMessage(content, [
        { kind: "text", text: content },
        {
          kind: "file_reference",
          file: {
            id: "docs /grill-me",
            path: "docs /grill-me",
            name: "grill-me",
            kind: "default",
          },
          sourceText: {
            value: content,
            start: 0,
            end: content.length,
          },
        },
      ]),
    );

    expect(withClaudeSkillMentions(session, [GRILL_SKILL])).toBe(session);
  });

  test("rechecks replaced messages that keep the same id", () => {
    const skills = [GRILL_SKILL, GITNEXUS_SKILL];
    const session = threadSession(userMessage("/grill-me"));
    withClaudeSkillMentions(session, skills);

    const updated = withClaudeSkillMentions(
      threadSession(userMessage("/gitnexus:generate_map (MCP)")),
      skills,
    );

    expect(updated.messages.items[0]?.meta).toMatchObject({
      kind: "user",
      parts: [
        { kind: "text", text: "/gitnexus:generate_map (MCP)" },
        { kind: "skill_mention", skill: GITNEXUS_SKILL },
      ],
    });
  });

  test("uses the current skill catalog after it changes", () => {
    const session = threadSession(userMessage("/grill-me"));
    const unrelatedSkills = [GITNEXUS_SKILL];
    expect(withClaudeSkillMentions(session, unrelatedSkills)).toBe(session);

    const skills = [GITNEXUS_SKILL, GRILL_SKILL];
    const initial = withClaudeSkillMentions(session, skills);
    expect(initial.messages.items[0]?.meta).toMatchObject({
      parts: [{ kind: "text" }, { kind: "skill_mention", skill: GRILL_SKILL }],
    });

    const updatedSkill = { ...GRILL_SKILL, title: "Review a plan", path: "/new/skill/path" };
    const updated = withClaudeSkillMentions(session, [updatedSkill]);
    expect(updated.messages.items[0]?.meta).toMatchObject({
      parts: [{ kind: "text" }, { kind: "skill_mention", skill: updatedSkill }],
    });
    expect(withClaudeSkillMentions(session, unrelatedSkills)).toBe(session);
  });
});
