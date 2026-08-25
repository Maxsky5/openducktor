export const inferredToken = Symbol();
export const otherInferredToken = Symbol();

export type InferredSymbolPayload = {
  readonly [inferredToken]: unknown;
  readonly [otherInferredToken]: string;
  readonly known: string;
};
