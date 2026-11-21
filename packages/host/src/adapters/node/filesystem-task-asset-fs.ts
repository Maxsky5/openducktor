import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { z } from "zod";

const nodeErrorSchema = z.object({ code: z.string() }).passthrough();

export const hasErrorCode = (cause: unknown, code: string): boolean => {
  const parsed = nodeErrorSchema.safeParse(cause);
  return parsed.success && parsed.data.code === code;
};

export const isMissing = (cause: unknown): boolean => hasErrorCode(cause, "ENOENT");

export const existingStat = async (target: string): Promise<Stats | null> => {
  try {
    return await lstat(target);
  } catch (cause) {
    if (isMissing(cause)) {
      return null;
    }
    throw cause;
  }
};
