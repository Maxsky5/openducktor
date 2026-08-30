import { z } from "zod";

export const codexInt32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
export const codexInt64Schema = z.number().int();
export const codexUint16Schema = z.number().int().nonnegative().max(65_535);
export const codexUint32Schema = z.number().int().nonnegative().max(4_294_967_295);
const safeNonnegativeIntegerSchema = z.number().int().nonnegative();
export const codexUint64Schema = safeNonnegativeIntegerSchema;
export const codexUsizeSchema = safeNonnegativeIntegerSchema;
