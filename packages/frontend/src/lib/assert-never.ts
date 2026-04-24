export const assertNever = (value: never, label = "Unhandled variant"): never => {
  throw new Error(`${label}: ${JSON.stringify(value)}`);
};
