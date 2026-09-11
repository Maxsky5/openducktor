import { z, type JSONType } from "zod";

const jsonValueSchema = z.json();

export const parseJson = (payload: string): JSONType => jsonValueSchema.parse(JSON.parse(payload));
