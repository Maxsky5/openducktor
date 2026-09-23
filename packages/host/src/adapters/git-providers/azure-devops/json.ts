import { z } from "zod";

export const azureDevOpsJsonSchema = z.json();
export const azureDevOpsJsonRecordSchema = z.record(z.string(), azureDevOpsJsonSchema);
export const azureDevOpsJsonListSchema = z.object({ value: z.array(azureDevOpsJsonSchema) });
export const azureDevOpsNonEmptyStringSchema = z.string().min(1);
export const azureDevOpsNumberSchema = z.number();
export const azureDevOpsPositiveIntegerSchema = z.number().int().positive();
export const azureDevOpsTimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)));

export type AzureDevOpsJson = z.infer<typeof azureDevOpsJsonSchema>;
export type AzureDevOpsJsonRecord = z.infer<typeof azureDevOpsJsonRecordSchema>;
