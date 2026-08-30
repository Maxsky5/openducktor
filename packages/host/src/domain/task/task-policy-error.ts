import type { OdtToolErrorCode } from "@openducktor/contracts";
import { Data } from "effect";

export type TaskPolicyErrorCode = Extract<
  OdtToolErrorCode,
  "TASK_POLICY_ERROR" | "TASK_TRANSITION_NOT_ALLOWED"
>;

export type TaskPolicyErrorDetails = {
  readonly reason: string;
  readonly taskId: string;
};

export type TaskPolicyErrorInput = {
  readonly code?: TaskPolicyErrorCode;
  readonly message: string;
  readonly details?: Readonly<TaskPolicyErrorDetails>;
};

export class TaskPolicyError extends Data.TaggedError("TaskPolicyError")<{
  readonly code: TaskPolicyErrorCode;
  readonly message: string;
  readonly details?: Readonly<TaskPolicyErrorDetails>;
}> {
  constructor({ code = "TASK_POLICY_ERROR", message, details }: TaskPolicyErrorInput) {
    super(details ? { code, message, details } : { code, message });
  }

  static policy(message: string, details?: Readonly<TaskPolicyErrorDetails>): TaskPolicyError {
    return new TaskPolicyError(details ? { message, details } : { message });
  }

  static transitionNotAllowed(
    message: string,
    details?: Readonly<TaskPolicyErrorDetails>,
  ): TaskPolicyError {
    return new TaskPolicyError(
      details
        ? { code: "TASK_TRANSITION_NOT_ALLOWED", message, details }
        : { code: "TASK_TRANSITION_NOT_ALLOWED", message },
    );
  }
}
