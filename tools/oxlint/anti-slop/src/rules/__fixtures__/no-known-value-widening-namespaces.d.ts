export type OpenCommands = { readonly start: () => void };

export namespace Types {
  export namespace Owner {
    export type OpenCommands = Record<string, () => void>;
  }
}

export namespace Other {
  export type OpenCommands = { readonly start: () => void };
}
