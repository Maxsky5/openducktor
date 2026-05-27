import { Data } from "effect";

export type TaskPolicyErrorCode = "TASK_POLICY_ERROR" | "TASK_TRANSITION_NOT_ALLOWED";

export class TaskPolicyError extends Data.TaggedError("TaskPolicyError")<{
  readonly code: TaskPolicyErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}> {
  constructor(
    message: string,
    details?: Readonly<Record<string, unknown>>,
    code: TaskPolicyErrorCode = "TASK_POLICY_ERROR",
  ) {
    super(details ? { code, message, details } : { code, message });
  }

  static withCode(
    code: TaskPolicyErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): TaskPolicyError {
    return new TaskPolicyError(message, details, code);
  }
}
