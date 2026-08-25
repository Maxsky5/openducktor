import type { ESTree } from "@oxlint/plugins";

/** Remove lint-runtime metadata so parsed Oxc nodes and Oxlint rule nodes share one AST shape. */
export type PortableAst<Value> = Value extends readonly (infer Item)[]
  ? readonly PortableAst<Item>[]
  : Value extends object
    ? {
        readonly [
          Key in keyof Value as Key extends "loc" | "parent" | "range" ? never : Key
        ]: PortableAst<Value[Key]>;
      }
    : Value;

export type PortableModuleItem = PortableAst<ESTree.Program["body"][number]>;
export type PortableNode = PortableAst<ESTree.Node>;
export type PortableTSInterfaceDeclaration = PortableAst<ESTree.TSInterfaceDeclaration>;
export type PortableTSModuleDeclaration = PortableAst<ESTree.TSModuleDeclaration>;
export type PortableTSType = PortableAst<ESTree.TSType>;
export type PortableTSTypeAliasDeclaration = PortableAst<ESTree.TSTypeAliasDeclaration>;
export type PortableTSTypeName = PortableAst<ESTree.TSTypeName>;
export type PortableTSTypeReference = PortableAst<ESTree.TSTypeReference>;
export type PortableTSTupleElement = PortableAst<ESTree.TSTupleElement>;
