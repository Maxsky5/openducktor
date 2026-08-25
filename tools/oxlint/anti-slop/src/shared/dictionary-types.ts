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
  readonly classes: ReadonlyMap<string, readonly ESTree.Class[]>;
  readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
  readonly namespaces: ReadonlyMap<string, readonly ESTree.TSModuleDeclaration[]>;
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
  readonly classes: Map<string, ESTree.Class[]>;
  readonly interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>;
  readonly competingInterfaceTypeNames: Set<string>;
  readonly namespaces: Map<string, ESTree.TSModuleDeclaration[]>;
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

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function typeNameParts(typeName: ESTree.TSTypeName): readonly string[] {
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

function qualifiedAliasDeclarations(
  typeName: ESTree.TSTypeName,
  environment: TypeEnvironment,
): readonly ESTree.TSTypeAliasDeclaration[] {
  const parts = typeNameParts(typeName);
  let environments: readonly TypeEnvironment[] = [environment];
  for (const namespaceName of parts.slice(0, -1)) {
    environments = environments.flatMap((candidate) =>
      namespaceEnvironments(namespaceName, candidate),
    );
  }
  const aliasName = parts.at(-1);
  return aliasName === undefined
    ? []
    : environments.flatMap((candidate) => {
        const alias = candidate.aliases.get(aliasName);
        return alias === undefined ? [] : [alias];
      });
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

export function typeResolvesToObject(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSObjectKeyword") return true;
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) => typeResolvesToObject(member, environment, resolving));
  }
  if (unwrapped.type !== "TSTypeReference" || unwrapped.typeArguments?.params.length) {
    return false;
  }
  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolving.has(referenceKey)) return false;
  const aliases = qualifiedAliasDeclarations(unwrapped.typeName, environment);
  if (aliases.length === 0) return false;
  const nextResolving = new Set(resolving);
  nextResolving.add(referenceKey);
  return aliases.some(
    (alias) =>
      (alias.typeParameters?.params.length ?? 0) === 0 &&
      typeResolvesToObject(
        alias.typeAnnotation,
        createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
        nextResolving,
      ),
  );
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
  name: string,
  declarations: readonly ESTree.TSInterfaceDeclaration[],
  environment: TypeEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): boolean {
  if (declarations.length === 0 || resolving.has(name)) return false;
  if (
    declarations.some(
      (declaration) =>
        declaration.body.body.length > 0 && !declaration.body.body.every(isEffectivelyEmptyMember),
    )
  ) {
    return false;
  }

  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return declarations.every((declaration) =>
    declaration.extends.every((heritage) => {
      if (heritage.expression.type !== "Identifier") return false;
      const inheritedName = heritage.expression.name;
      const inheritedDeclarations = environment.interfaces.get(inheritedName);
      return (
        inheritedDeclarations !== undefined &&
        isEffectivelyEmptyInterface(
          inheritedName,
          inheritedDeclarations,
          environment,
          nextResolving,
        )
      );
    }),
  );
}

function classHasInstanceMember(declaration: ESTree.Class): boolean {
  return declaration.body.body.some((member) => {
    if (member.type === "StaticBlock" || ("static" in member && member.static)) return false;
    if (member.type !== "MethodDefinition" || member.kind !== "constructor") return true;
    return member.value.params.some((parameter) => parameter.type === "TSParameterProperty");
  });
}

function isEffectivelyEmptyClass(
  name: string,
  declarations: readonly ESTree.Class[],
  environment: TypeEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): boolean {
  if (declarations.length === 0 || resolving.has(name)) return false;
  if (declarations.some(classHasInstanceMember)) return false;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return declarations.every((declaration) => {
    if (declaration.superClass === null) return true;
    if (declaration.superClass.type !== "Identifier") return false;
    const inheritedName = declaration.superClass.name;
    const inheritedClasses = environment.classes.get(inheritedName);
    return (
      inheritedClasses !== undefined &&
      isEffectivelyEmptyClass(inheritedName, inheritedClasses, environment, nextResolving)
    );
  });
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
  const classDeclarations = environment.classes.get(name);
  if (interfaceDeclarations !== undefined || classDeclarations !== undefined) {
    const interfacesAreEmpty =
      interfaceDeclarations === undefined ||
      isEffectivelyEmptyInterface(name, interfaceDeclarations, environment);
    const classesAreEmpty =
      classDeclarations === undefined ||
      isEffectivelyEmptyClass(name, classDeclarations, environment);
    return interfacesAreEmpty && classesAreEmpty ? "empty-object" : null;
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

function interfaceWideningTarget(
  name: string,
  declarations: readonly ESTree.TSInterfaceDeclaration[],
  environment: TypeEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): WideningTarget | null {
  if (resolving.has(name)) return null;
  if (
    declarations.some((declaration) =>
      declaration.body.body.some((member) => member.type === "TSIndexSignature"),
    )
  ) {
    return { kind: "open dictionary" };
  }
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  for (const declaration of declarations) {
    for (const heritage of declaration.extends) {
      if (heritage.expression.type !== "Identifier") continue;
      const heritageName = heritage.expression.name;
      if (heritageName === "Record" && isBuiltIn(heritageName, environment)) {
        return { kind: "open dictionary" };
      }
      if (TRANSPARENT_WRAPPERS.has(heritageName) && isBuiltIn(heritageName, environment)) {
        const wrapped = heritage.typeArguments?.params[0];
        const target = wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
        if (target !== null) return target;
      }
      const inheritedInterfaces = environment.interfaces.get(heritageName);
      if (inheritedInterfaces !== undefined) {
        const target = interfaceWideningTarget(
          heritageName,
          inheritedInterfaces,
          environment,
          nextResolving,
        );
        if (target !== null) return target;
      }
      const heritageAlias = environment.aliases.get(heritageName);
      if (heritageAlias !== undefined && (heritageAlias.typeParameters?.params.length ?? 0) === 0) {
        const target = classifyAliasBroadTarget(
          heritageAlias.typeAnnotation,
          createTypeEnvironment(heritageAlias.typeAnnotation, environment.visitorKeys),
          new Map(),
          new Set([heritageName]),
        );
        if (target !== null) return target;
      }
    }
  }
  return null;
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
  if (interfaceDeclarations !== undefined) {
    const target = interfaceWideningTarget(name, interfaceDeclarations, environment);
    if (target !== null) return target;
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

/** Resolve whether a visible TypeScript type exposes any to its caller. */
export function typeResolvesToAny(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment = new Map(),
  resolvingAliases: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSAnyKeyword") return true;
  if (unwrapped.type === "TSUnionType" || unwrapped.type === "TSIntersectionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToAny(member, environment, substitutions, resolvingAliases),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name === null) return false;
  const substitution = substitutions.get(name);
  if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
    return typeResolvesToAny(
      substitution.type,
      substitution.environment,
      substitutions,
      resolvingAliases,
    );
  }
  if ((name === "Promise" || name === "PromiseLike") && isBuiltIn(name, environment)) {
    const value = unwrapped.typeArguments?.params[0];
    return (
      value !== undefined && typeResolvesToAny(value, environment, substitutions, resolvingAliases)
    );
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined || resolvingAliases.has(name)) return false;
  const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
  if (nextSubstitutions === null) return false;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(name);
  return typeResolvesToAny(
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
