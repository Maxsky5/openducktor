import { type JsonValue, jsonValueSchema } from "@openducktor/contracts";

export const parseJson = (payload: string): JsonValue => jsonValueSchema.parse(JSON.parse(payload));
