import type { HostInvokeFailure } from "@openducktor/contracts";
import type { HostCommandArgs, HostCommandName, HostCommandResult } from "@openducktor/host";
import { z } from "zod";

export class HostInvokeError extends Error {
  override readonly cause: unknown;

  constructor(
    message: string,
    readonly failure: HostInvokeFailure | null = null,
    cause?: unknown,
  ) {
    super(message);
    this.name = "HostInvokeError";
    this.cause = cause;
  }
}

export type InvokeFn = <Command extends HostCommandName, Result extends HostCommandResult<Command>>(
  command: Command,
  args: Exclude<HostCommandArgs, undefined> | undefined,
  resultSchema: z.ZodType<Result>,
) => Promise<Result>;

export type OkResult = { ok: boolean };
export type UpdatedAtResult = { updatedAt: string };

export const voidResultSchema = z
  .union([z.undefined(), z.null()])
  .transform((): undefined => undefined);
export const booleanResultSchema = z.boolean();

export const arrayResultSchema = <T>(schema: z.ZodType<T>, command: string) =>
  z.array(schema, `Expected array payload from host command ${command}`);

export const okResultSchema = (command: string) => {
  const error = `Expected { ok: boolean } payload from host command ${command}`;
  return z.object({ ok: z.boolean(error) }, error);
};

export const updatedAtResultSchema = (command: string) => {
  const error = `Expected { updatedAt: string } payload from host command ${command}`;
  return z.object(
    {
      updatedAt: z.string(error).refine((value) => value.trim().length > 0, error),
    },
    error,
  );
};
