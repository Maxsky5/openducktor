import { z } from "zod";
import { hasRuntimeType } from "./runtime-type";

export type ExactOptional<Type, Leaf = never> = Type extends Leaf
  ? Type
  : Type extends readonly (infer Item)[]
    ? ExactOptional<Item, Leaf>[]
    : Type extends object
      ? string extends keyof Type
        ? { [Key in keyof Type]: ExactOptional<Type[Key], Leaf> }
        : {
            [Key in keyof Type as undefined extends Type[Key] ? never : Key]: ExactOptional<
              Type[Key],
              Leaf
            >;
          } & {
            [Key in keyof Type as undefined extends Type[Key] ? Key : never]?: ExactOptional<
              Exclude<Type[Key], undefined>,
              Leaf
            >;
          }
      : Type;

const hasExplicitUndefined = <Value extends object>(value: Value): boolean => {
  for (const entry of Object.values(value)) {
    if (entry === undefined) {
      return true;
    }
    if (hasRuntimeType(entry, "object") && entry !== null && hasExplicitUndefined(entry)) {
      return true;
    }
  }
  return false;
};

export const exactOptionalSchema = <Output extends object, Input>(
  schema: z.ZodType<Output, Input>,
) =>
  schema
    .refine((value) => !hasExplicitUndefined(value), {
      message: "Optional properties must be omitted instead of set to undefined.",
    })
    .transform((value) => {
      // SAFETY: The preceding refinement rejects every explicit undefined property recursively.
      return value as ExactOptional<Output>;
    });
