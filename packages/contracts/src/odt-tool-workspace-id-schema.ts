import { z } from "zod";

/** The optional workspace of an OpenDucktor tool call. A managed session never gives it. */
export const odtToolWorkspaceIdSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Overrides the startup workspace.");
