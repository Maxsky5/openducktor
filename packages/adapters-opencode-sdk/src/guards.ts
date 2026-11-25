import { z, type JSONType } from "zod";

export type OpenCodeProtocolValue = JSONType;
export type OpenCodeProtocolObject = Record<string, OpenCodeProtocolValue>;

export const opencodeProtocolValueSchema = z.json();
export const opencodeProtocolObjectSchema = z.record(z.string(), opencodeProtocolValueSchema);
