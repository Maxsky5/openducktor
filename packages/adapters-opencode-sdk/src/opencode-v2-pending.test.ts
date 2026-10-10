import { describe, expect, test } from "bun:test";
import type { FormInfo } from "@opencode/client";
import { agentSessionLivePendingQuestionRequestSchema } from "@openducktor/contracts";
import {
  projectApproval,
  projectQuestion,
  permissionDecision,
  replyForm,
} from "./opencode-pending";
import { nativeClient, noContent } from "./opencode-v2.test-support";

const form: FormInfo = {
  id: "form_native",
  sessionID: "ses_saved",
  title: "Choose settings",
  fields: [
    {
      key: "pick",
      type: "string",
      title: "Choice",
      required: true,
      options: [{ label: "Friendly label", value: "native_value" }],
    },
    { key: "many", type: "multiselect", options: [{ label: "One", value: "one" }] },
    { key: "text", type: "string" },
  ],
};
describe("OpenCode V2 pending input", () => {
  test("keeps empty declared values for multiselect and optional string fields", async () => {
    const emptyValues: FormInfo = {
      ...form,
      fields: [
        {
          key: "pick",
          type: "multiselect",
          required: true,
          options: [{ label: "No preference", value: "" }],
        },
        { key: "note", type: "string", options: [{ label: "No note", value: "" }] },
      ],
    };
    const bodies: unknown[] = [];
    const client = nativeClient(({ body }) => {
      bodies.push(body);
      return noContent();
    });
    await replyForm(client, emptyValues, [[""], [""]]);
    await replyForm(client, emptyValues, [[""], []]);
    expect(bodies).toEqual([{ answer: { pick: [""], note: "" } }, { answer: { pick: [""] } }]);
    const requiredString: FormInfo = {
      ...form,
      fields: [{ key: "required", type: "string", required: true }],
    };
    await expect(replyForm(client, requiredString, [[""]])).rejects.toThrow("Check the answer");
    expect(bodies).toHaveLength(2);
  });
  test("sends field keys and native option values while retaining literal text", async () => {
    const bodies: unknown[] = [];
    const client = nativeClient(({ body }) => {
      bodies.push(body);
      return noContent();
    });
    expect(projectQuestion(form)).toMatchObject({
      questions: [
        { options: [{ label: "Friendly label", value: "native_value" }], required: true },
        { multiple: true, required: false },
        { custom: true },
      ],
    });
    await replyForm(client, form, [["native_value"], ["one"], ["  literal text  "]]);
    expect(bodies).toEqual([
      { answer: { pick: "native_value", many: ["one"], text: "  literal text  " } },
    ]);
    await expect(replyForm(client, form, [["Friendly label"], [], []])).rejects.toThrow(
      "Choose a listed value",
    );
    expect(bodies).toHaveLength(1);
  });
  test("omits unanswered optional closed fields and permits native cancellation", async () => {
    expect(
      agentSessionLivePendingQuestionRequestSchema.parse(projectQuestion(form)).canCancel,
    ).toBe(true);
    const requests: unknown[] = [];
    const client = nativeClient(({ url, method, body }) => {
      requests.push([method, url.pathname, body]);
      return noContent();
    });
    await replyForm(client, form, [["native_value"], [], []]);
    expect(requests[0]).toEqual([
      "POST",
      "/api/session/ses_saved/form/form_native/reply",
      { answer: { pick: "native_value" } },
    ]);
    await replyForm(client, form, []);
    expect(requests[1]).toEqual(["DELETE", "/api/session/ses_saved/form/form_native", {}]);
  });
  test("keeps unsupported native constraints visible and rejects partial answers", async () => {
    const unsupported: FormInfo = {
      ...form,
      fields: [{ key: "secret", type: "string", pattern: "^[a-z]+$", required: true }],
    };
    expect(projectQuestion(unsupported).unsupportedReason).toContain("constraints");
    const client = nativeClient(() => {
      throw new Error("No submission expected");
    });
    await expect(replyForm(client, unsupported, [["answer"]])).rejects.toThrow("cannot represent");
  });
  test("labels native always replies as project grants and rejects session-scoped outcomes", () => {
    const approval = projectApproval(
      {
        id: "permission_native",
        sessionID: "ses_saved",
        action: "shell",
        resources: ["git status"],
        save: ["git status*"],
        metadata: { command: "git status" },
      },
      "/repo",
    );
    expect(approval.persistentGrant).toEqual({
      scope: "project",
      projectDirectory: "/repo",
      rules: [{ action: "shell", resource: "git status*" }],
    });
    expect(approval.mutation).toBe("read_only");
    expect(permissionDecision("approve_always")).toBe("always");
    expect(permissionDecision("reject")).toBe("reject");
    expect(() => permissionDecision("approve_session")).toThrow("does not support");
  });
  test("preserves native keys that also exist on Object.prototype", async () => {
    const keyedForm: FormInfo = {
      ...form,
      fields: [
        { key: "__proto__", type: "string", required: true },
        { key: "constructor", type: "string", required: true },
      ],
    };
    const bodies: unknown[] = [];
    const client = nativeClient(({ body }) => {
      bodies.push(body);
      return noContent();
    });
    await replyForm(client, keyedForm, [["literal answer"], ["second answer"]]);
    expect(bodies).toEqual([
      {
        answer: Object.fromEntries([
          ["__proto__", "literal answer"],
          ["constructor", "second answer"],
        ]),
      },
    ]);
  });
  test("does not promise a project grant when the native request has no save rules", () => {
    const request = projectApproval(
      { id: "permission_custom", sessionID: "ses_saved", action: "custom", resources: ["target"] },
      "/repo",
    );
    expect(request.supportedReplyOutcomes).toEqual(["approve_once", "reject"]);
    expect(request.persistentGrant).toBeUndefined();
    expect(request.rejectsAllPendingApprovals).toBe(true);
  });
});
