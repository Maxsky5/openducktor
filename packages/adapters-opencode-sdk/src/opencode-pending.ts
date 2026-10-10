import type { FormInfo, OpenCodeClient, PermissionRequest } from "@opencode/client";
import type { AgentPendingApprovalRequest, AgentPendingQuestionRequest } from "@openducktor/core";
import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { classifyOpenCodeApprovalMutation } from "./opencode-approval-classifier";
import { z } from "zod";

export const projectApproval = (
  request: PermissionRequest,
  projectDirectory: string,
): AgentPendingApprovalRequest => {
  const command = z.string().safeParse(request.metadata?.command).data;
  const tool = z.string().safeParse(request.metadata?.tool).data;
  const approval: AgentPendingApprovalRequest = {
    requestId: request.id,
    requestType: "permission_grant",
    title: `Approve ${request.action}`,
    summary: request.message ?? `OpenCode requested ${request.action}.`,
    action: { name: request.action },
    affectedPaths: request.resources,
    mutation: classifyOpenCodeApprovalMutation({
      permission: request.action,
      patterns: request.resources,
      command,
      toolName: tool,
    }),
    rejectsAllPendingApprovals: true,
    supportedReplyOutcomes: request.save?.length
      ? ["approve_once", "approve_always", "reject"]
      : ["approve_once", "reject"],
  };
  if (command) approval.command = { command };
  if (tool) approval.tool = { name: tool };
  if (request.save?.length)
    approval.persistentGrant = {
      scope: "project",
      projectDirectory,
      rules: request.save.map((resource) => ({ action: request.action, resource })),
    };
  return approval;
};

export const permissionDecision = (
  outcome: RuntimeApprovalReplyOutcome,
): "once" | "always" | "reject" => {
  if (outcome === "approve_once") return "once";
  if (outcome === "approve_always") return "always";
  if (outcome === "reject") return "reject";
  throw new Error(
    `OpenCode V2 does not support '${outcome}'. Choose Approve once, Allow for project, or Reject.`,
  );
};

export const projectQuestion = (form: FormInfo): AgentPendingQuestionRequest => {
  const keys = new Set<string>();
  let unsupportedReason: string | undefined;
  const questions = form.fields.map((field) => {
    if (!field.key || keys.has(field.key))
      unsupportedReason = "The form has missing or repeated field keys.";
    keys.add(field.key);
    if (field.type !== "string" && field.type !== "multiselect") {
      unsupportedReason = `OpenDucktor cannot answer the native '${field.type}' field. Cancel this form and use a supported question.`;
      return {
        header: field.title ?? field.key,
        question: field.description ?? form.title,
        options: [],
        custom: false,
      };
    }
    const values = (field.options ?? []).map((option) => option.value);
    if (new Set(values).size !== values.length)
      unsupportedReason = "The form has repeated option values.";
    if (
      field.hidden ||
      field.when?.length ||
      field.default !== undefined ||
      (field.type === "string" &&
        (field.format ||
          field.pattern ||
          field.minLength !== undefined ||
          field.maxLength !== undefined)) ||
      (field.type === "multiselect" &&
        (field.minItems !== undefined || field.maxItems !== undefined))
    )
      unsupportedReason =
        "This native form has constraints that OpenDucktor cannot represent. Cancel it and use a supported question.";
    return {
      header: field.title ?? field.key,
      question: field.description ?? form.title,
      options: (field.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? "",
        value: option.value,
      })),
      multiple: field.type === "multiselect",
      custom: field.options === undefined || field.custom === true,
      required: field.required ?? false,
    };
  });
  const request: AgentPendingQuestionRequest = { requestId: form.id, questions, canCancel: true };
  if (unsupportedReason) request.unsupportedReason = unsupportedReason;
  return request;
};

export const replyForm = async (
  client: OpenCodeClient,
  form: FormInfo,
  answers: string[][],
): Promise<void> => {
  if (answers.length === 0) {
    await client.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
    return;
  }
  const projected = projectQuestion(form);
  if (projected.unsupportedReason) throw new Error(projected.unsupportedReason);
  if (answers.length !== form.fields.length)
    throw new Error("Answer every native form field in order.");
  const answer: Record<string, string | string[]> = Object.create(null);
  for (const [index, field] of form.fields.entries()) {
    if (field.type !== "string" && field.type !== "multiselect")
      throw new Error(`Unsupported form field '${field.key}'.`);
    const values = answers[index]!;
    if (!field.required && values.length === 0) continue;
    if (
      (field.type === "string" && values.length > 1) ||
      (field.required &&
        (values.length === 0 ||
          (field.type === "string" && values.some((value) => value.length === 0))))
    )
      throw new Error(`Check the answer for '${field.title ?? field.key}'.`);
    if (new Set(values).size !== values.length)
      throw new Error(`Choose each value only once for '${field.key}'.`);
    if (
      field.options &&
      !field.custom &&
      values.some((value) => !field.options!.some((option) => option.value === value))
    )
      throw new Error(`Choose a listed value for '${field.key}'.`);
    answer[field.key] = field.type === "string" ? (values[0] ?? "") : values;
  }
  await client.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer });
};
