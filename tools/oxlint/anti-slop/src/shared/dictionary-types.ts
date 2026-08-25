import type { ESTree } from "@oxlint/plugins";

import {
  createTypeEnvironment,
  isBuiltInType as isBuiltIn,
  referencedTypeScopes,
  TRANSPARENT_TYPE_WRAPPERS as TRANSPARENT_WRAPPERS,
  typeNameParts,
  typeReferenceName,
  type TypeEnvironment,
} from "./type-environment.ts";

export { createTypeEnvironment } from "./type-environment.ts";
export type { TypeEnvironment } from "./type-environment.ts";
export { classifyWideningTarget } from "./widening-target.ts";
export type { WideningTarget } from "./widening-target.ts";

type ScopedType = {
  readonly environment: TypeEnvironment;
  readonly type: ESTree.TSType;
};

type TypeAliasEnvironment = ReadonlyMap<string, ScopedType>;

export type ImportedObjectTypeResolver = (
  type: ESTree.TSTypeReference,
  environment: TypeEnvironment,
) => boolean;

type ResolvedType = ScopedType & {
  readonly substitutions: TypeAliasEnvironment;
};

export type UnsafeDictionary = {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

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
  resolveImportedObject?: ImportedObjectTypeResolver,
): boolean {
  return typeResolvesToObjectWithSubstitutions(
    type,
    environment,
    new Map(),
    new Set(),
    resolveImportedObject,
  );
}

function typeResolvesToObjectWithSubstitutions(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolving: ReadonlySet<string>,
  resolveImportedObject?: ImportedObjectTypeResolver,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSObjectKeyword") return true;
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToObjectWithSubstitutions(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedObject,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const simpleName = typeReferenceName(unwrapped);
  if (
    simpleName !== null &&
    TRANSPARENT_WRAPPERS.has(simpleName) &&
    isBuiltIn(simpleName, environment)
  ) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return (
      wrapped !== undefined &&
      typeResolvesToObjectWithSubstitutions(
        wrapped,
        environment,
        substitutions,
        resolving,
        resolveImportedObject,
      )
    );
  }
  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolving.has(referenceKey)) return false;
  if (simpleName !== null) {
    const substitution = substitutions.get(simpleName);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, simpleName)) {
      return typeResolvesToObjectWithSubstitutions(
        substitution.type,
        substitution.environment,
        substitutions,
        resolving,
        resolveImportedObject,
      );
    }
  }
  const resolvesLocally = referencedTypeScopes(unwrapped.typeName, environment).some((scope) => {
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined) return false;
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
    if (nextSubstitutions === null) return false;
    const nextResolving = new Set(resolving);
    nextResolving.add(referenceKey);
    return typeResolvesToObjectWithSubstitutions(
      alias.typeAnnotation,
      createTypeEnvironment(alias.typeAnnotation, scope.environment.visitorKeys),
      nextSubstitutions,
      nextResolving,
      resolveImportedObject,
    );
  });
  return resolvesLocally || resolveImportedObject?.(unwrapped, environment) === true;
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
  type: { readonly typeArguments?: ESTree.TSTypeParameterInstantiation | null },
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
  const simpleName = typeReferenceName(unwrapped);
  if (
    simpleName !== null &&
    TRANSPARENT_WRAPPERS.has(simpleName) &&
    isBuiltIn(simpleName, environment)
  ) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
  }
  const substitution = simpleName === null ? undefined : substitutions.get(simpleName);
  if (simpleName !== null && substitution !== undefined) {
    return isUnappliedReferenceTo(substitution.type, simpleName)
      ? null
      : unsafeDirectValue(
          substitution.type,
          substitution.environment,
          substitutions,
          resolvingAliases,
        );
  }
  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolvingAliases.has(referenceKey)) return null;
  for (const scope of referencedTypeScopes(unwrapped.typeName, environment)) {
    const interfaceDeclarations = scope.environment.interfaces.get(scope.name);
    const classDeclarations = scope.environment.classes.get(scope.name);
    if (interfaceDeclarations !== undefined || classDeclarations !== undefined) {
      const interfacesAreEmpty =
        interfaceDeclarations === undefined ||
        isEffectivelyEmptyInterface(scope.name, interfaceDeclarations, scope.environment);
      const classesAreEmpty =
        classDeclarations === undefined ||
        isEffectivelyEmptyClass(scope.name, classDeclarations, scope.environment);
      return interfacesAreEmpty && classesAreEmpty ? "empty-object" : null;
    }
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined) continue;
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
    if (nextSubstitutions === null) continue;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(referenceKey);
    return unsafeDirectValue(
      alias.typeAnnotation,
      createTypeEnvironment(alias.typeAnnotation, scope.environment.visitorKeys),
      nextSubstitutions,
      nextResolving,
    );
  }
  return null;
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
  const simpleName = typeReferenceName(unwrapped);

  const substitution = simpleName === null ? undefined : substitutions.get(simpleName);
  if (simpleName !== null && substitution !== undefined) {
    return isUnappliedReferenceTo(substitution.type, simpleName)
      ? []
      : dictionaryValueTypes(
          substitution.type,
          substitution.environment,
          substitutions,
          resolvingAliases,
        );
  }

  if (
    simpleName !== null &&
    TRANSPARENT_WRAPPERS.has(simpleName) &&
    isBuiltIn(simpleName, environment)
  ) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? []
      : dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
  }

  if (simpleName === "Record" && isBuiltIn(simpleName, environment)) {
    const value = unwrapped.typeArguments?.params[1] ?? null;
    return value === null ? [] : [{ type: value, environment, substitutions }];
  }

  if ((simpleName === "Pick" || simpleName === "Omit") && isBuiltIn(simpleName, environment)) {
    const source = unwrapped.typeArguments?.params[0];
    return source === undefined
      ? []
      : dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
  }

  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolvingAliases.has(referenceKey)) return [];
  return referencedTypeScopes(unwrapped.typeName, environment).flatMap((scope) => {
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined) return [];
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, environment, substitutions);
    if (nextSubstitutions === null) return [];
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(referenceKey);
    return dictionaryValueTypes(
      alias.typeAnnotation,
      createTypeEnvironment(alias.typeAnnotation, scope.environment.visitorKeys),
      nextSubstitutions,
      nextResolving,
    );
  });
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

export function classifyUnsafeInterfaceHeritage(
  heritage: ESTree.TSInterfaceHeritage,
  environment: TypeEnvironment,
): UnsafeDictionary | null {
  if (heritage.expression.type !== "Identifier") return null;
  const name = heritage.expression.name;
  if (name === "Record" && isBuiltIn(name, environment)) {
    const valueType = heritage.typeArguments?.params[1];
    return valueType === undefined ? null : classifyUnsafeDictionaryValue(valueType, environment);
  }
  if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
    const wrapped = heritage.typeArguments?.params[0];
    return wrapped === undefined ? null : classifyUnsafeDictionary(wrapped, environment);
  }
  const alias = environment.aliases.get(name);
  if (alias === undefined) return null;
  const substitutions = aliasSubstitution(alias, heritage, environment, new Map());
  if (substitutions === null) return null;
  for (const valueType of dictionaryValueTypes(
    alias.typeAnnotation,
    createTypeEnvironment(alias.typeAnnotation, environment.visitorKeys),
    substitutions,
    new Set([name]),
  )) {
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
