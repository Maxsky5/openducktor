import type { OdtToolErrorCode } from "@openducktor/contracts";
import { Data } from "effect";
import type { JsonValue } from "@openducktor/contracts";

export type TaskPolicyErrorCode = Extract<
  OdtToolErrorCode,
  "TASK_POLICY_ERROR" | "TASK_TRANSITION_NOT_ALLOWED"
>;

export type TaskPolicyErrorInput = {
  readonly code?: TaskPolicyErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
};

export class TaskPolicyError extends Data.TaggedError("TaskPolicyError")<{
  readonly code: TaskPolicyErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>> | undefined;
}> {
  constructor({ code = "TASK_POLICY_ERROR", message, details }: TaskPolicyErrorInput) {
    super(details ? { code, message, details } : { code, message });
  }

  static policy(message: string, details?: Readonly<Record<string, JsonValue>>): TaskPolicyError {
    return new TaskPolicyError(details ? { message, details } : { message });
  }

  static transitionNotAllowed(
    message: string,
    details?: Readonly<Record<string, JsonValue>>,
  ): TaskPolicyError {
    return new TaskPolicyError(
      details
        ? { code: "TASK_TRANSITION_NOT_ALLOWED", message, details }
        : { code: "TASK_TRANSITION_NOT_ALLOWED", message },
    );
  }
}
