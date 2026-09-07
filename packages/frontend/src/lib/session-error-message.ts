import { agentToolDataSchema } from "@openducktor/contracts";
import { z } from "zod";

const stringValueSchema = z.string();

export const normalizeSessionErrorMessage = (value: string): string => {
  const trimmed = value.trim();
  const withoutQuotes = trimmed
    .replace(/^["'“”]+/, "")
    .replace(/["'“”]+$/, "")
    .trim();

  if (!withoutQuotes.startsWith("{")) {
    return withoutQuotes;
  }

  try {
    const parsed = z.json().parse(JSON.parse(withoutQuotes));
    const record = agentToolDataSchema.safeParse(parsed);
    if (!record.success) {
      return withoutQuotes;
    }
    const messageResult = stringValueSchema.safeParse(record.data.message);
    if (messageResult.success && messageResult.data.trim().length > 0) {
      return messageResult.data.trim();
    }
    const nestedError = agentToolDataSchema.safeParse(record.data.error);
    if (nestedError.success) {
      const nestedMessageResult = stringValueSchema.safeParse(nestedError.data.message);
      if (nestedMessageResult.success) {
        return nestedMessageResult.data.trim();
      }
    }
    return withoutQuotes;
  } catch {
    return withoutQuotes;
  }
};
