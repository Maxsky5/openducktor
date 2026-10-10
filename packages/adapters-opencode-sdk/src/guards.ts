import { z, type JSONType } from "zod";

export type OpenCodeProtocolValue = JSONType;
export type OpenCodeProtocolObject = Record<string, OpenCodeProtocolValue>;

export const opencodeProtocolValueSchema = z.json();
export const opencodeProtocolObjectSchema = z.record(z.string(), opencodeProtocolValueSchema);

export const asJsonObject = (
  value: OpenCodeProtocolValue | undefined,
): OpenCodeProtocolObject | undefined => {
  const parsed = opencodeProtocolObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export const readStringArrayProp = (
  source: OpenCodeProtocolValue | undefined,
  key: string,
): string[] | undefined => {
  const record = asJsonObject(source);
  const values = z.array(z.string()).safeParse(record?.[key]);
  return values.success ? values.data : undefined;
};
