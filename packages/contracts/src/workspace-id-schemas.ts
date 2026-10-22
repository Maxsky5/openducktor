import { z } from "zod";

export const WORKSPACE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const workspaceIdSchema = z
  .string()
  .trim()
  .min(1, "Workspace ID cannot be blank.")
  .regex(
    WORKSPACE_ID_PATTERN,
    "Workspace ID must contain only lowercase letters, digits, and single dashes.",
  );
