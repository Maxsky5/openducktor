import { describe, expect, test } from "bun:test";
import type { SessionInboxUser, SkillInfo } from "@opencode/client";
import type { AgentSessionScope } from "@openducktor/contracts";
import {
  createController,
  cursorPage,
  noContent,
  ref,
  response,
  session,
} from "./opencode-v2.test-support";

const skills: SkillInfo[] = [
  {
    id: "native.review",
    name: "review",
    path: "/repo/.agents/skills/review/SKILL.md",
    description: "Review the change.",
    content: "Native review instructions.",
  },
  {
    id: "native.check",
    name: "check",
    path: "/repo/.agents/skills/check/SKILL.md",
    content: "Native check instructions.",
  },
];

describe("OpenCode V2 skill references", () => {
  test.each([
    { label: "available", result: response(skills), status: "available" },
    { label: "empty", result: response([]), status: "available" },
    {
      label: "unavailable",
      result: Response.json({ message: "Skill read failed" }, { status: 503 }),
      status: "failed",
    },
    {
      label: "malformed",
      result: response([{ id: "native.review", name: "review" }]),
      status: "failed",
    },
  ])(
    "keeps $label skill results separate from the other catalogs",
    async ({ result, status, label }) => {
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname === "/api/skill") return result;
        if (url.pathname === "/api/model/default") return response(null);
        if (["/api/model", "/api/provider", "/api/agent", "/api/command"].includes(url.pathname))
          return response([]);
        throw new Error(`Unexpected catalog request ${method} ${url.pathname}`);
      });
      const catalog = await controller.loadRuntimeCatalog({
        ...ref,
        workingDirectory: "/repo/worktree",
      });
      expect(catalog.skills?.status).toBe(status);
      expect(catalog.models?.status).toBe("available");
      expect(catalog.slashCommands?.status).toBe("available");
      expect(catalog.subagents?.status).toBe("available");
      if (label === "available")
        expect(catalog.skills).toEqual({
          status: "available",
          catalog: {
            skills: [
              {
                id: "native.review",
                name: "review",
                path: skills[0]!.path,
                description: "Review the change.",
              },
              { id: "native.check", name: "check", path: skills[1]!.path },
            ],
          },
        });
      if (label === "empty")
        expect(catalog.skills).toEqual({ status: "available", catalog: { skills: [] } });
      if (catalog.skills?.status === "failed") expect(catalog.skills.cause).toBeInstanceOf(Error);
      const request = requests.find(({ url }) => url.pathname === "/api/skill");
      expect(request?.url.searchParams.get("location[directory]")).toBe("/repo/worktree");
      expect(request?.method).toBe("GET");
    },
  );

  test.each([
    { label: "repository", sessionScope: { kind: "repository" } },
    { label: "workflow", sessionScope: { kind: "workflow", taskId: "task-1", role: "build" } },
  ] satisfies { label: string; sessionScope: AgentSessionScope }[])(
    "sends inline skills with native IDs in $label prompts and commands",
    async ({ sessionScope }) => {
      const workingDirectory = process.platform === "win32" ? "D:\\repo" : "/repo";
      const text = "😀 Use $review with @src/a.ts then $check and $review.";
      const nativeSkills = [
        { id: "native.review", mention: { text: "$review", start: 7, end: 14 } },
        { id: "native.check", mention: { text: "$check", start: 35, end: 41 } },
        { id: "native.review", mention: { text: "$review", start: 46, end: 53 } },
      ];
      const payload: SessionInboxUser["payload"] = {
        text,
        skills: [
          { ...nativeSkills[0]!, name: "review", text: "Native review instructions." },
          { ...nativeSkills[1]!, name: "check", text: "Native check instructions." },
          { ...nativeSkills[2]!, name: "review" },
        ],
      };
      const { controller, requests } = createController(({ url, method }) => {
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (method === "PATCH" || method === "PUT" || url.pathname.endsWith("/command"))
          return noContent();
        if (url.pathname === "/api/session/ses_saved")
          return response(session({ location: { directory: workingDirectory } }));
        if (url.pathname.endsWith("/instructions/entries")) return response([]);
        if (url.pathname.endsWith("/message"))
          return cursorPage([{ id: "msg_skills", type: "user", time: { created: 8 }, ...payload }]);
        if (url.pathname.endsWith("/prompt"))
          return response({
            id: "msg_skills",
            sessionID: ref.externalSessionId,
            type: "user",
            payload,
            delivery: "prompt",
            time: { created: 8 },
          });
        throw new Error(`Unexpected skill request ${method} ${url.pathname}`);
      });
      const input = {
        ...ref,
        workingDirectory,
        runtimePolicy: { kind: "opencode" as const },
        sessionScope,
        systemPrompt: "Use the OpenDucktor workflow instructions.",
        parts: [
          { kind: "text" as const, text: "😀 Use " },
          { kind: "skill_mention" as const, skill: skills[0]! },
          { kind: "text" as const, text: " with " },
          {
            kind: "file_reference" as const,
            file: { id: "src/a.ts", path: "src/a.ts", name: "a.ts", kind: "code" as const },
          },
          { kind: "text" as const, text: " then " },
          { kind: "skill_mention" as const, skill: skills[1]! },
          { kind: "text" as const, text: " and " },
          { kind: "skill_mention" as const, skill: skills[0]! },
          { kind: "text" as const, text: "." },
        ],
      };
      const accepted = await controller.sendUserMessage(input);
      if (accepted.type !== "user_message") throw new Error("Expected accepted skill references");
      const expectedBody = {
        text,
        skills: nativeSkills,
        files: [
          {
            uri:
              process.platform === "win32" ? "file:///D:/repo/src/a.ts" : "file:///repo/src/a.ts",
            name: "a.ts",
            mention: { text: "@src/a.ts", start: 20, end: 29 },
          },
        ],
      };
      expect(requests.find(({ url }) => url.pathname.endsWith("/prompt"))?.body).toEqual(
        expectedBody,
      );
      const history = await controller.loadSessionHistory({ ...ref, workingDirectory });
      expect(accepted.parts).toEqual(history[0]?.displayParts);
      expect(accepted.parts.filter((part) => part.kind === "skill_mention")).toEqual([
        {
          kind: "skill_mention",
          skill: { id: "native.review", name: "review", path: "native.review" },
          sourceText: { value: "$review", start: 7, end: 14 },
        },
        {
          kind: "skill_mention",
          skill: { id: "native.check", name: "check", path: "native.check" },
          sourceText: { value: "$check", start: 35, end: 41 },
        },
        {
          kind: "skill_mention",
          skill: { id: "native.review", name: "review", path: "native.review" },
          sourceText: { value: "$review", start: 46, end: 53 },
        },
      ]);
      expect(
        await controller.sendUserMessage({
          ...input,
          parts: [
            {
              kind: "slash_command",
              command: { id: "review", trigger: "review", title: "Review", hints: [] },
            },
            ...input.parts,
          ],
        }),
      ).toEqual({ type: "command_accepted", commandName: "review" });
      expect(requests.find(({ url }) => url.pathname.endsWith("/command"))?.body).toEqual({
        name: "review",
        ...expectedBody,
      });
    },
  );
});
