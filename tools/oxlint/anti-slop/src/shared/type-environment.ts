import type { ESTree } from "@oxlint/plugins";

import { lexicalStructuralTypeParameterNames } from "./lexical-type-parameters.ts";

const BUILT_INS = new Set([
  "Record",
  "Readonly",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "PropertyKey",
  "NonNullable",
  "Promise",
  "PromiseLike",
]);

export const TRANSPARENT_TYPE_WRAPPERS: ReadonlySet<string> = new Set([
  "Readonly",
  "Partial",
  "Required",
  "NonNullable",
]);

export type TypeEnvironment = {
  readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
  readonly classes: ReadonlyMap<string, readonly ESTree.Class[]>;
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly namespaces: ReadonlyMap<string, readonly ESTree.TSModuleDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
  readonly visitorKeys: Readonly<Record<string, readonly string[]>>;
};

type DeclarationLayer = {
  readonly aliases: Map<string, ESTree.TSTypeAliasDeclaration>;
  readonly classes: Map<string, ESTree.Class[]>;
  readonly interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>;
  readonly competingInterfaceTypeNames: Set<string>;
  readonly namespaces: Map<string, ESTree.TSModuleDeclaration[]>;
  readonly typeNames: Set<string>;
};

export type ReferencedTypeScope = {
  readonly environment: TypeEnvironment;
  readonly name: string;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
}

function typeDeclarationName(declaration: ESTree.Node): string | null {
  if (declaration.type === "ImportDeclaration") return null;
  if (
    declaration.type === "TSTypeAliasDeclaration" ||
    declaration.type === "TSInterfaceDeclaration" ||
    declaration.type === "TSEnumDeclaration" ||
    declaration.type === "ClassDeclaration"
  ) {
    return declaration.id?.name ?? null;
  }
  if (declaration.type === "TSImportEqualsDeclaration") return declaration.id.name;
  return null;
}

function collectDeclarationLayer(statements: readonly ESTree.Statement[]): DeclarationLayer {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  const classes = new Map<string, ESTree.Class[]>();
  const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
  const competingInterfaceTypeNames = new Set<string>();
  const namespaces = new Map<string, ESTree.TSModuleDeclaration[]>();
  const typeNames = new Set<string>();

  for (const statement of statements) {
    const declaration = declaredStatement(statement);
    if (declaration?.type === "ImportDeclaration") {
      for (const specifier of declaration.specifiers) {
        typeNames.add(specifier.local.name);
        competingInterfaceTypeNames.add(specifier.local.name);
      }
      continue;
    }
    if (declaration === null) continue;
    if (
      declaration.type === "TSModuleDeclaration" &&
      declaration.global === false &&
      declaration.id.type === "Identifier"
    ) {
      const declarations = namespaces.get(declaration.id.name) ?? [];
      declarations.push(declaration);
      namespaces.set(declaration.id.name, declarations);
      continue;
    }
    const name = typeDeclarationName(declaration);
    if (name === null) continue;
    typeNames.add(name);
    if (declaration.type === "TSTypeAliasDeclaration") {
      aliases.set(name, declaration);
      competingInterfaceTypeNames.add(name);
      continue;
    }
    if (declaration.type === "TSInterfaceDeclaration") {
      const declarations = interfaces.get(name) ?? [];
      declarations.push(declaration);
      interfaces.set(name, declarations);
      continue;
    }
    if (declaration.type === "ClassDeclaration") {
      const declarations = classes.get(name) ?? [];
      declarations.push(declaration);
      classes.set(name, declarations);
      continue;
    }
    competingInterfaceTypeNames.add(name);
  }

  return {
    aliases,
    classes,
    competingInterfaceTypeNames,
    interfaces,
    namespaces,
    typeNames,
  };
}

function scopeStatements(node: ESTree.Node): readonly ESTree.Statement[] | null {
  if (
    node.type === "Program" ||
    node.type === "BlockStatement" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock"
  ) {
    return node.body;
  }
  if (node.type === "SwitchStatement") {
    return node.cases.flatMap((case_) => case_.consequent);
  }
  return null;
}

function applyNameShadow(
  name: string,
  aliases: Map<string, ESTree.TSTypeAliasDeclaration>,
  classes: Map<string, readonly ESTree.Class[]>,
  interfaces: Map<string, readonly ESTree.TSInterfaceDeclaration[]>,
  namespaces: Map<string, readonly ESTree.TSModuleDeclaration[]>,
  shadowedBuiltIns: Set<string>,
): void {
  aliases.delete(name);
  classes.delete(name);
  interfaces.delete(name);
  namespaces.delete(name);
  if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
}

/** Build the visible TypeScript type declarations at one AST node. */
export function createTypeEnvironment(
  node: ESTree.Node,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): TypeEnvironment {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  const classes = new Map<string, readonly ESTree.Class[]>();
  const interfaces = new Map<string, readonly ESTree.TSInterfaceDeclaration[]>();
  const namespaces = new Map<string, readonly ESTree.TSModuleDeclaration[]>();
  const shadowedBuiltIns = new Set<string>();
  const ancestry: ESTree.Node[] = [];
  let current: ESTree.Node | null = node;
  while (current !== null) {
    ancestry.push(current);
    current = current.parent;
  }

  for (const ancestor of ancestry.reverse()) {
    const statements = scopeStatements(ancestor);
    if (statements !== null) {
      const layer = collectDeclarationLayer(statements);
      for (const name of layer.typeNames) {
        applyNameShadow(name, aliases, classes, interfaces, namespaces, shadowedBuiltIns);
      }
      for (const [name, alias] of layer.aliases) aliases.set(name, alias);
      for (const [name, declarations] of layer.classes) classes.set(name, declarations);
      for (const [name, declarations] of layer.interfaces) {
        if (!layer.competingInterfaceTypeNames.has(name)) interfaces.set(name, declarations);
      }
      for (const [name, declarations] of layer.namespaces) namespaces.set(name, declarations);
    }
    if ("typeParameters" in ancestor) {
      for (const parameter of ancestor.typeParameters?.params ?? []) {
        applyNameShadow(
          parameter.name.name,
          aliases,
          classes,
          interfaces,
          namespaces,
          shadowedBuiltIns,
        );
      }
    }
  }

  for (const name of lexicalStructuralTypeParameterNames(node, visitorKeys)) {
    applyNameShadow(name, aliases, classes, interfaces, namespaces, shadowedBuiltIns);
  }

  return { aliases, classes, interfaces, namespaces, shadowedBuiltIns, visitorKeys };
}

export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

export function typeNameParts(typeName: ESTree.TSTypeName): readonly string[] {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return [];
  return [...typeNameParts(typeName.left), typeName.right.name];
}

function namespaceEnvironments(
  name: string,
  environment: TypeEnvironment,
): readonly TypeEnvironment[] {
  return (environment.namespaces.get(name) ?? []).flatMap((declaration) =>
    declaration.body?.type === "TSModuleBlock"
      ? [createTypeEnvironment(declaration.body, environment.visitorKeys)]
      : [],
  );
}

export function referencedTypeScopes(
  typeName: ESTree.TSTypeName,
  environment: TypeEnvironment,
): readonly ReferencedTypeScope[] {
  const parts = typeNameParts(typeName);
  let environments: readonly TypeEnvironment[] = [environment];
  for (const namespaceName of parts.slice(0, -1)) {
    environments = environments.flatMap((candidate) =>
      namespaceEnvironments(namespaceName, candidate),
    );
  }
  const name = parts.at(-1);
  return name === undefined
    ? []
    : environments.map((candidate) => ({ environment: candidate, name }));
}

export function isBuiltInType(name: string, environment: TypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}
