export type ClosedCommands = { readonly start: () => void };
export type OpenCommands = Record<string, () => void>;
