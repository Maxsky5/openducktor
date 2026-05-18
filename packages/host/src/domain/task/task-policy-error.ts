import { Data } from "effect";

export class TaskPolicyError extends Data.TaggedError("TaskPolicyError")<{
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}> {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(details ? { message, details } : { message });
  }
}
