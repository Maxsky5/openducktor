import { z } from "zod";
import { withMaxUtf16Length } from "./string-schemas";

/**
 * Validators for the two per-workspace identity values that the workspace rail shows.
 *
 * They live in their own module because both the persisted configuration schema and the workspace
 * record contract use them, and `config-schemas` already imports `git-schemas`.
 *
 * Each value has two schemas. The normalizing pair trims and lower-cases user input on the way
 * into the configuration file. The value-only pair validates an already normalized value and adds
 * no transform, because a transform cannot be represented in JSON Schema and `workspaceRecordSchema`
 * is converted to JSON Schema for the MCP tool surface.
 */

const ABBREVIATION_BLANK_MESSAGE = "Abbreviation cannot be blank.";
const TILE_COLOR_MESSAGE = "Tile color must be a 6-digit RGB hex value, such as #3b82f6.";

export const WORKSPACE_ABBREVIATION_MAX_LENGTH = 3;

export const WORKSPACE_TILE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const workspaceAbbreviationValueSchema = withMaxUtf16Length(
  z.string().min(1, ABBREVIATION_BLANK_MESSAGE),
  WORKSPACE_ABBREVIATION_MAX_LENGTH,
);

export const workspaceTileColorValueSchema = z
  .string()
  .regex(WORKSPACE_TILE_COLOR_PATTERN, TILE_COLOR_MESSAGE);

export const workspaceAbbreviationSchema = withMaxUtf16Length(
  z.string().trim().min(1, ABBREVIATION_BLANK_MESSAGE),
  WORKSPACE_ABBREVIATION_MAX_LENGTH,
);

export const workspaceTileColorSchema = z
  .string()
  .trim()
  .regex(WORKSPACE_TILE_COLOR_PATTERN, TILE_COLOR_MESSAGE)
  .transform((value) => value.toLowerCase());
