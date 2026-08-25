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
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);

type ScopedType = {
  readonly environment: TypeEnvironment;
  readonly type: ESTree.TSType;
};

type TypeAliasEnvironment = ReadonlyMap<string, ScopedType>;

type ResolvedType = ScopedType & {
  readonly substitutions: TypeAliasEnvironment;
};

export type UnsafeDictionary = {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

export type WideningTargetKind =
  | "anonymous object"
  | "generic container"
  | "object"
  | "open dictionary"
  | "unknown";

export type WideningTarget = {
  readonly kind: WideningTargetKind;
};

export type TypeEnvironment = {
  readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
  readonly visitorKeys: Readonly<Record<string, readonly string[]>>;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
}

type DeclarationLayer = {
  readonly aliases: Map<string, ESTree.TSTypeAliasDeclaration>;
  readonly interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>;
  readonly nonInterfaceTypeNames: Set<string>;
  readonly typeNames: Set<string>;
};

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
  if (declaration.type === "TSModuleDeclaration" && declaration.id.type === "Identifier") {
    return declaration.id.name;
  }
  if (declaration.type === "TSImportEqualsDeclaration") return declaration.id.name;
  return null;
}

function collectDeclarationLayer(statements: readonly ESTree.Statement[]): DeclarationLayer {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
  const nonInterfaceTypeNames = new Set<string>();
  const typeNames = new Set<string>();

  for (const statement of statements) {
    const declaration = declaredStatement(statement);
    if (declaration?.type === "ImportDeclaration") {
      for (const specifier of declaration.specifiers) {
        typeNames.add(specifier.local.name);
        nonInterfaceTypeNames.add(specifier.local.name);
      }
      continue;
    }
    if (declaration === null) continue;
    const name = typeDeclarationName(declaration);
    if (name === null) continue;
    typeNames.add(name);
    if (declaration.type === "TSTypeAliasDeclaration") {
      aliases.set(name, declaration);
      nonInterfaceTypeNames.add(name);
      continue;
    }
    if (declaration.type === "TSInterfaceDeclaration") {
      const declarations = interfaces.get(name) ?? [];
      declarations.push(declaration);
      interfaces.set(name, declarations);
      continue;
    }
    nonInterfaceTypeNames.add(name);
  }

  return { aliases, interfaces, nonInterfaceTypeNames, typeNames };
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
  interfaces: Map<string, readonly ESTree.TSInterfaceDeclaration[]>,
  shadowedBuiltIns: Set<string>,
): void {
  aliases.delete(name);
  interfaces.delete(name);
  if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
}

/** Build the visible TypeScript type declarations at one AST node. */
export function createTypeEnvironment(
  node: ESTree.Node,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): TypeEnvironment {
  const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
  const interfaces = new Map<string, readonly ESTree.TSInterfaceDeclaration[]>();
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
        applyNameShadow(name, aliases, interfaces, shadowedBuiltIns);
      }
      for (const [name, alias] of layer.aliases) aliases.set(name, alias);
      for (const [name, declarations] of layer.interfaces) {
        if (!layer.nonInterfaceTypeNames.has(name)) interfaces.set(name, declarations);
      }
    }
    if ("typeParameters" in ancestor) {
      for (const parameter of ancestor.typeParameters?.params ?? []) {
        applyNameShadow(parameter.name.name, aliases, interfaces, shadowedBuiltIns);
      }
    }
  }

  for (const name of lexicalStructuralTypeParameterNames(node, visitorKeys)) {
    applyNameShadow(name, aliases, interfaces, shadowedBuiltIns);
  }

  return { aliases, interfaces, shadowedBuiltIns, visitorKeys };
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null ||
      unwrapped.typeArguments === undefined ||
      unwrapped.typeArguments.params.length === 0)
  );
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

function isNeverType(type: ESTree.TSType): boolean {
  return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
  return (
    member.type === "TSPropertySignature" &&
    member.optional === true &&
    member.typeAnnotation !== null &&
    member.typeAnnotation !== undefined &&
    isNeverType(member.typeAnnotation.typeAnnotation)
  );
}

function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
  return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
  declarations: readonly ESTree.TSInterfaceDeclaration[],
): boolean {
  if (declarations.length !== 1) return false;
  const [type] = declarations;
  return (
    type !== undefined &&
    type.extends.length === 0 &&
    (type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember))
  );
}

function resolvedSubstitutionArgument(
  scopedType: ScopedType,
  base: TypeAliasEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): ScopedType {
  const unwrapped = unwrapTransparentType(scopedType.type);
  if (unwrapped.type !== "TSTypeReference") return scopedType;
  const name = typeReferenceName(unwrapped);
  if (name === null || resolving.has(name)) return scopedType;
  const substitution = base.get(name);
  if (substitution === undefined) return scopedType;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

function aliasSubstitution(
  alias: ESTree.TSTypeAliasDeclaration,
  type: ESTree.TSTypeReference,
  referenceEnvironment: TypeEnvironment,
  base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = type.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index] ?? parameter.default;
    if (argument === null || argument === undefined) return null;
    const environment =
      arguments_[index] === undefined
        ? createTypeEnvironment(argument, referenceEnvironment.visitorKeys)
        : referenceEnvironment;
    next.set(
      parameter.name.name,
      resolvedSubstitutionArgument({ type: argument, environment }, next),
    );
  }
  return next;
}

function unsafeDirectValue(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary["unsafeValue"] | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return null;
  if (unwrapped.type === "TSAnyKeyword") return "any";
  if (unwrapped.type === "TSObjectKeyword") return "object";
  if (unwrapped.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(unwrapped))
    return "empty-object";
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some(
      (member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
    )
      ? "union"
      : null;
  }
  if (unwrapped.type === "TSIntersectionType") {
    const unsafeMembers = unwrapped.types.map((member) =>
      unsafeDirectValue(member, environment, substitutions, resolvingAliases),
    );
    if (unsafeMembers.includes("any")) return "any";
    const firstUnsafeMember = unsafeMembers[0];
    return firstUnsafeMember !== undefined && unsafeMembers.every((member) => member !== null)
      ? firstUnsafeMember
      : null;
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  if (name === null) return null;
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
  }
  const substitution = substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution.type, name)
      ? null
      : unsafeDirectValue(
          substitution.type,
          substitution.environment,
          substitutions,
          resolvingAliases,
        );
  }
  const interfaceDeclarations = environment.interfaces.get(name);
  if (interfaceDeclarations !== undefined) {
    return isEffectivelyEmptyInterface(interfaceDeclarations) ? "empty-object" : null;
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return null;
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return null;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return unsafeDirectValue(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    nextSubstitutions,
    nextResolving,
  );
}

function dictionaryValueTypes(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
  const unwrapped = unwrapTransparentType(type);

  if (unwrapped.type === "TSTypeLiteral") {
    return unwrapped.members.flatMap((member): readonly ResolvedType[] =>
      member.type === "TSIndexSignature" && member.typeAnnotation !== null
        ? [{ type: member.typeAnnotation.typeAnnotation, environment, substitutions }]
        : [],
    );
  }

  if (unwrapped.type === "TSMappedType") {
    const valueSubstitutions = new Map(substitutions);
    valueSubstitutions.delete(unwrapped.key.name);
    return unwrapped.typeAnnotation === null
      ? []
      : [
          {
            type: unwrapped.typeAnnotation,
            environment: createTypeEnvironment(unwrapped.typeAnnotation, environment.visitorKeys),
            substitutions: valueSubstitutions,
          },
        ];
  }

  if (unwrapped.type !== "TSTypeReference") return [];
  const name = typeReferenceName(unwrapped);
  if (name === null) return [];

  const substitution = substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution.type, name)
      ? []
      : dictionaryValueTypes(
          substitution.type,
          substitution.environment,
          substitutions,
          resolvingAliases,
        );
  }

  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? []
      : dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
  }

  if (name === "Record" && isBuiltIn(name, environment)) {
    const value = unwrapped.typeArguments?.params[1] ?? null;
    return value === null ? [] : [{ type: value, environment, substitutions }];
  }

  if ((name === "Pick" || name === "Omit") && isBuiltIn(name, environment)) {
    const source = unwrapped.typeArguments?.params[0];
    return source === undefined
      ? []
      : dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
  }

  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return [];
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return [];
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return dictionaryValueTypes(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    nextSubstitutions,
    nextResolving,
  );
}

export function classifyUnsafeDictionaryValue(
  valueType: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
  return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

export function classifyUnsafeDictionary(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
    const unsafeValue = unsafeDirectValue(
      valueType.type,
      valueType.environment,
      valueType.substitutions,
      new Set(),
    );
    if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
  }
  return null;
}

function resolvesToDictionary(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
): boolean {
  return dictionaryValueTypes(type, environment, substitutions, resolvingAliases).length > 0;
}

export function classifyWideningTarget(
  type: ESTree.TSType,
  environment: TypeEnvironment,
): WideningTarget | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
  if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
  if (unwrapped.type === "TSTypeLiteral") {
    return unwrapped.members.some((member) => member.type === "TSIndexSignature")
      ? { kind: "open dictionary" }
      : unwrapped.members.length > 0
        ? { kind: "anonymous object" }
        : null;
  }
  if (unwrapped.type === "TSMappedType") return { kind: "open dictionary" };
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  if (name === null) return null;
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
  }
  if (name === "Record" && isBuiltIn(name, environment)) return { kind: "open dictionary" };
  const interfaceDeclarations = environment.interfaces.get(name);
  if (interfaceDeclarations?.length === 1) {
    const [declaration] = interfaceDeclarations;
    const heritage = declaration?.extends[0];
    if (
      declaration !== undefined &&
      declaration.body.body.length === 0 &&
      declaration.extends.length === 1 &&
      heritage !== undefined &&
      heritage.expression.type === "Identifier"
    ) {
      const heritageName = heritage.expression.name;
      if (heritageName === "Record" && isBuiltIn(heritageName, environment)) {
        return { kind: "open dictionary" };
      }
      if (TRANSPARENT_WRAPPERS.has(heritageName) && isBuiltIn(heritageName, environment)) {
        const wrapped = heritage.typeArguments?.params[0];
        return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
      }
      const heritageAlias = environment.aliases.get(heritageName);
      if (heritageAlias !== undefined && (heritageAlias.typeParameters?.params.length ?? 0) === 0) {
        return classifyAliasBroadTarget(
          heritageAlias.typeAnnotation,
          createTypeEnvironment(heritageAlias.typeAnnotation, environment.visitorKeys),
          new Map(),
          new Set([heritageName]),
        );
      }
    }
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined) return null;
  const aliasEnvironment = createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys);
  if ((alias.typeParameters?.params.length ?? 0) > 0) {
    const substitutions = aliasSubstitution(alias, unwrapped, environment, new Map());
    return substitutions !== null &&
      resolvesToDictionary(alias.typeAnnotation, aliasEnvironment, substitutions, new Set([name]))
      ? { kind: "generic container" }
      : null;
  }
  const substitutions = aliasSubstitution(alias, unwrapped, environment, new Map());
  if (substitutions === null) return null;
  const resolved = classifyAliasBroadTarget(
    alias.typeAnnotation,
    aliasEnvironment,
    substitutions,
    new Set([name]),
  );
  return resolved;
}

function isBroadMappedKey(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (
    unwrapped.type === "TSStringKeyword" ||
    unwrapped.type === "TSNumberKeyword" ||
    unwrapped.type === "TSSymbolKeyword"
  ) {
    return true;
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.every((member) => isBroadMappedKey(member, environment, substitutions));
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name === null) return false;
  const substitution = substitutions.get(name);
  if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
    return isBroadMappedKey(substitution.type, substitution.environment, substitutions);
  }
  return name === "PropertyKey" && isBuiltIn(name, environment);
}

function classifyAliasBroadTarget(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
  if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
  if (unwrapped.type === "TSTypeLiteral") {
    return unwrapped.members.some((member) => member.type === "TSIndexSignature")
      ? { kind: "open dictionary" }
      : null;
  }
  if (unwrapped.type === "TSMappedType") {
    return isBroadMappedKey(unwrapped.constraint, environment, substitutions)
      ? { kind: "open dictionary" }
      : null;
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  if (name === null) return null;
  const substitution = substitutions.get(name);
  if (substitution !== undefined) {
    return isUnappliedReferenceTo(substitution.type, name)
      ? null
      : classifyAliasBroadTarget(
          substitution.type,
          substitution.environment,
          substitutions,
          resolvingAliases,
        );
  }
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : classifyAliasBroadTarget(wrapped, environment, substitutions, resolvingAliases);
  }
  if (name === "Record" && isBuiltIn(name, environment)) {
    return { kind: "open dictionary" };
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return null;
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return null;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return classifyAliasBroadTarget(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    nextSubstitutions,
    nextResolving,
  );
}

function indexedStringValueResolvesToUnknown(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name === null) return false;
  const substitution = substitutions.get(name);
  if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
    return indexedStringValueResolvesToUnknown(
      substitution.type,
      substitution.environment,
      substitutions,
      resolvingAliases,
    );
  }
  if (name === "Record" && isBuiltIn(name, environment)) {
    const [key, value] = unwrapped.typeArguments?.params ?? [];
    return (
      key?.type === "TSStringKeyword" &&
      value !== undefined &&
      typeResolvesToUnknown(value, environment, substitutions, resolvingAliases)
    );
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return false;
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return false;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return indexedStringValueResolvesToUnknown(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    nextSubstitutions,
    nextResolving,
  );
}

/** Resolve whether a visible TypeScript type exposes unknown to its caller. */
export function typeResolvesToUnknown(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment = new Map(),
  resolvingAliases: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return true;
  if (unwrapped.type === "TSIndexedAccessType" && unwrapped.indexType.type === "TSStringKeyword") {
    return indexedStringValueResolvesToUnknown(
      unwrapped.objectType,
      environment,
      substitutions,
      resolvingAliases,
    );
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToUnknown(member, environment, substitutions, resolvingAliases),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name === null) return false;
  const substitution = substitutions.get(name);
  if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
    return typeResolvesToUnknown(
      substitution.type,
      substitution.environment,
      substitutions,
      resolvingAliases,
    );
  }
  if ((name === "Promise" || name === "PromiseLike") && isBuiltIn(name, environment)) {
    const value = unwrapped.typeArguments?.params[0];
    return (
      value !== undefined &&
      typeResolvesToUnknown(value, environment, substitutions, resolvingAliases)
    );
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return false;
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return false;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return typeResolvesToUnknown(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    nextSubstitutions,
    nextResolving,
  );
}

export function isPopulatedObjectExpression(expression: ESTree.Expression): boolean {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current.type === "ObjectExpression" && current.properties.length > 0;
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }
  if (current.type === "ObjectExpression") return true;
  return (
    current.type === "ArrayExpression" ||
    current.type === "ArrowFunctionExpression" ||
    current.type === "ClassExpression" ||
    current.type === "FunctionExpression" ||
    current.type === "NewExpression" ||
    current.type === "Literal" ||
    current.type === "TemplateLiteral" ||
    current.type === "UnaryExpression"
  );
}
