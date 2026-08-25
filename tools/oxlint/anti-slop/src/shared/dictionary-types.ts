import type { ESTree } from "@oxlint/plugins";

import type { PortableAst, PortableClass, PortableTSType } from "./portable-ast.ts";
import {
  propertyKeyDomainIncludes,
  propertyKeyDomainIsBroad,
  resolveOpenDictionaryKeyDomain,
  resolvePropertyKeyDomain,
} from "./property-key-domain.ts";

import {
  aliasSubstitution,
  enterTypeResolution,
  isBuiltInType,
  isUnappliedReferenceTo,
  referencedTypeScopes,
  resolveInterfaceHeritage,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeParameterSubstitution,
  typeNameParts,
  typeReferenceName,
  unwrapTransparentType,
  withoutVisibleTypeName,
  type PortableTypeArgument,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type ResolvedPortableType,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";

type ResolvedType = PortableTypeArgument;

type ResolvedAliasState = {
  readonly resolving: ReadonlySet<string>;
  readonly substitutions: TypeSubstitutions;
};

export type UnsafeDictionary = {
  readonly kind: "unsafe-dictionary";
  readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

function resolvedAliasState(
  resolved: Extract<ResolvedPortableType, { kind: "alias" }>,
  resolving: ReadonlySet<string>,
  query: string,
): ResolvedAliasState | null {
  const nextResolving = enterTypeResolution(resolving, resolved.key, query);
  if (nextResolving === null) return null;
  const nextSubstitutions = aliasSubstitution(
    resolved.declaration,
    resolved.arguments,
    resolved.environment,
    resolved.resolveImportedType,
  );
  return nextSubstitutions === null
    ? null
    : { resolving: nextResolving, substitutions: nextSubstitutions };
}

function substitutedType(
  type: PortableTSType,
  substitutions: TypeSubstitutions,
): PortableTypeArgument | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  const substitution = name === null ? undefined : substitutions.get(name);
  return name !== null &&
    substitution !== undefined &&
    !isUnappliedReferenceTo(substitution.type, name)
    ? substitution
    : null;
}

export function typeResolvesToObject(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return typeResolvesToObjectWithState(
    type,
    environment,
    new Map(),
    new Set(),
    resolveImportedType,
  );
}

function typeResolvesToObjectWithState(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSObjectKeyword") return true;
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToObjectWithState(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const substitution = substitutedType(unwrapped, substitutions);
  if (substitution !== null) {
    return typeResolvesToObjectWithState(
      substitution.type,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(unwrapped);
  if (name !== null && TRANSPARENT_TYPE_WRAPPERS.has(name) && isBuiltInType(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return (
      wrapped !== undefined &&
      typeResolvesToObjectWithState(
        wrapped,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    );
  }
  return resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).some(
    (resolved) => {
      if (resolved.kind !== "alias") return false;
      const state = resolvedAliasState(resolved, resolving, "object");
      return (
        state !== null &&
        typeResolvesToObjectWithState(
          resolved.declaration.typeAnnotation,
          resolved.environment,
          state.substitutions,
          state.resolving,
          resolved.resolveImportedType,
        )
      );
    },
  );
}

function isNeverType(type: PortableTSType): boolean {
  return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: PortableAst<ESTree.TSSignature>): boolean {
  return (
    member.type === "TSPropertySignature" &&
    member.optional === true &&
    member.typeAnnotation !== null &&
    member.typeAnnotation !== undefined &&
    isNeverType(member.typeAnnotation.typeAnnotation)
  );
}

function isEffectivelyEmptyTypeLiteral(type: PortableAst<ESTree.TSTypeLiteral>): boolean {
  return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
  resolved: Extract<ResolvedPortableType, { kind: "interface" }>,
  resolving: ReadonlySet<string>,
): boolean {
  const nextResolving = enterTypeResolution(resolving, resolved.key, "empty-interface");
  if (nextResolving === null || resolved.declarations.length === 0) return false;
  return resolved.declarations.every((declaration) => {
    if (declaration.body.body.some((member) => !isEffectivelyEmptyMember(member))) return false;
    const substitutions = typeParameterSubstitution(
      declaration.typeParameters?.params ?? [],
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (substitutions === null) return false;
    return declaration.extends.every((heritage) => {
      const inherited = resolveInterfaceHeritage(
        heritage,
        resolved.environment,
        substitutions,
        resolved.resolveImportedType,
      );
      return (
        inherited.length > 0 &&
        inherited.every(
          (candidate) =>
            candidate.kind === "interface" && isEffectivelyEmptyInterface(candidate, nextResolving),
        )
      );
    });
  });
}

function classHasInstanceMember(declaration: PortableClass): boolean {
  return declaration.body.body.some((member) => {
    if (member.type === "StaticBlock" || ("static" in member && member.static)) return false;
    if (member.type !== "MethodDefinition" || member.kind !== "constructor") return true;
    return member.value.params.some((parameter) => parameter.type === "TSParameterProperty");
  });
}

function isEffectivelyEmptyClass(
  name: string,
  declarations: readonly PortableClass[],
  environment: PortableTypeEnvironment,
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

function unsafeDirectValue(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): UnsafeDictionary["unsafeValue"] | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return null;
  if (unwrapped.type === "TSAnyKeyword") return "any";
  if (unwrapped.type === "TSObjectKeyword") return "object";
  if (unwrapped.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(unwrapped)) {
    return "empty-object";
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some(
      (member) =>
        unsafeDirectValue(member, environment, substitutions, resolving, resolveImportedType) !==
        null,
    )
      ? "union"
      : null;
  }
  if (unwrapped.type === "TSIntersectionType") {
    const unsafeMembers = unwrapped.types.map((member) =>
      unsafeDirectValue(member, environment, substitutions, resolving, resolveImportedType),
    );
    if (unsafeMembers.includes("any")) return "any";
    const first = unsafeMembers[0];
    return first !== undefined && unsafeMembers.every((member) => member !== null) ? first : null;
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const substitution = substitutedType(unwrapped, substitutions);
  if (substitution !== null) {
    return unsafeDirectValue(
      substitution.type,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(unwrapped);
  if (name !== null && TRANSPARENT_TYPE_WRAPPERS.has(name) && isBuiltInType(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : unsafeDirectValue(wrapped, environment, substitutions, resolving, resolveImportedType);
  }
  for (const scope of referencedTypeScopes(typeNameParts(unwrapped.typeName), environment)) {
    const classDeclarations = scope.environment.classes.get(scope.name);
    if (classDeclarations !== undefined) {
      return isEffectivelyEmptyClass(scope.name, classDeclarations, scope.environment)
        ? "empty-object"
        : null;
    }
  }
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    if (resolved.kind === "interface") {
      return isEffectivelyEmptyInterface(resolved, resolving) ? "empty-object" : null;
    }
    const state = resolvedAliasState(resolved, resolving, "unsafe-value");
    if (state === null) continue;
    const unsafe = unsafeDirectValue(
      resolved.declaration.typeAnnotation,
      resolved.environment,
      state.substitutions,
      state.resolving,
      resolved.resolveImportedType,
    );
    if (unsafe !== null) return unsafe;
  }
  return null;
}

function dictionaryValueTypes(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): readonly ResolvedType[] {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSTypeLiteral") {
    return unwrapped.members.flatMap((member): readonly ResolvedType[] =>
      member.type === "TSIndexSignature" && member.typeAnnotation !== null
        ? [
            {
              type: member.typeAnnotation.typeAnnotation,
              environment,
              resolveImportedType,
              substitutions,
            },
          ]
        : [],
    );
  }
  if (unwrapped.type === "TSMappedType") {
    const keyDomain = resolvePropertyKeyDomain(
      unwrapped.constraint,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
    );
    if (!propertyKeyDomainIsBroad(keyDomain)) return [];
    const valueSubstitutions = new Map(substitutions);
    valueSubstitutions.delete(unwrapped.key.name);
    const valueEnvironment = withoutVisibleTypeName(environment, unwrapped.key.name);
    return unwrapped.typeAnnotation === null
      ? []
      : [
          {
            type: unwrapped.typeAnnotation,
            environment: valueEnvironment,
            resolveImportedType,
            substitutions: valueSubstitutions,
          },
        ];
  }
  if (unwrapped.type !== "TSTypeReference") return [];
  const substitution = substitutedType(unwrapped, substitutions);
  if (substitution !== null) {
    return dictionaryValueTypes(
      substitution.type,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(unwrapped);
  if (name !== null && TRANSPARENT_TYPE_WRAPPERS.has(name) && isBuiltInType(name, environment)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? []
      : dictionaryValueTypes(wrapped, environment, substitutions, resolving, resolveImportedType);
  }
  if (name === "Record" && isBuiltInType(name, environment)) {
    const [key, value] = unwrapped.typeArguments?.params ?? [];
    const keyDomain =
      key === undefined
        ? null
        : resolvePropertyKeyDomain(key, environment, substitutions, resolveImportedType, resolving);
    return value === undefined || keyDomain === null || !propertyKeyDomainIsBroad(keyDomain)
      ? []
      : [{ type: value, environment, resolveImportedType, substitutions }];
  }
  if ((name === "Pick" || name === "Omit") && isBuiltInType(name, environment)) {
    const source = unwrapped.typeArguments?.params[0];
    const remainingKeys = resolveOpenDictionaryKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
    );
    return source === undefined || !propertyKeyDomainIsBroad(remainingKeys)
      ? []
      : dictionaryValueTypes(source, environment, substitutions, resolving, resolveImportedType);
  }
  return resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).flatMap(
    (resolved): readonly ResolvedType[] => {
      if (resolved.kind !== "alias") return [];
      const state = resolvedAliasState(resolved, resolving, "dictionary-values");
      return state === null
        ? []
        : dictionaryValueTypes(
            resolved.declaration.typeAnnotation,
            resolved.environment,
            state.substitutions,
            state.resolving,
            resolved.resolveImportedType,
          );
    },
  );
}

export function classifyUnsafeDictionaryValue(
  valueType: PortableTSType,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): UnsafeDictionary | null {
  const unsafeValue = unsafeDirectValue(
    valueType,
    environment,
    new Map(),
    new Set(),
    resolveImportedType,
  );
  return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

export function classifyUnsafeDictionary(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): UnsafeDictionary | null {
  for (const valueType of dictionaryValueTypes(
    type,
    environment,
    new Map(),
    new Set(),
    resolveImportedType,
  )) {
    const unsafeValue = unsafeDirectValue(
      valueType.type,
      valueType.environment,
      valueType.substitutions,
      new Set(),
      valueType.resolveImportedType,
    );
    if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
  }
  return null;
}

export function classifyUnsafeInterfaceHeritage(
  heritage: PortableAst<ESTree.TSInterfaceHeritage>,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): UnsafeDictionary | null {
  const name = heritage.expression.type === "Identifier" ? heritage.expression.name : null;
  if (name === "Record" && isBuiltInType(name, environment)) {
    const [key, value] = heritage.typeArguments?.params ?? [];
    return key === undefined ||
      value === undefined ||
      !propertyKeyDomainIsBroad(
        resolvePropertyKeyDomain(key, environment, new Map(), resolveImportedType),
      )
      ? null
      : classifyUnsafeDictionaryValue(value, environment, resolveImportedType);
  }
  if (name !== null && TRANSPARENT_TYPE_WRAPPERS.has(name) && isBuiltInType(name, environment)) {
    const wrapped = heritage.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : classifyUnsafeDictionary(wrapped, environment, resolveImportedType);
  }
  for (const resolved of resolveInterfaceHeritage(
    heritage,
    environment,
    new Map(),
    resolveImportedType,
  )) {
    if (resolved.kind !== "alias") continue;
    const state = resolvedAliasState(resolved, new Set(), "dictionary-heritage");
    if (state === null) continue;
    for (const valueType of dictionaryValueTypes(
      resolved.declaration.typeAnnotation,
      resolved.environment,
      state.substitutions,
      state.resolving,
      resolved.resolveImportedType,
    )) {
      const unsafeValue = unsafeDirectValue(
        valueType.type,
        valueType.environment,
        valueType.substitutions,
        new Set(),
        valueType.resolveImportedType,
      );
      if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
    }
  }
  return null;
}

function indexedValueResolvesToUnknown(
  objectType: PortableTSType,
  indexType: PortableTypeArgument,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  const object = unwrapTransparentType(objectType);
  if (object.type !== "TSTypeReference") return false;
  const substitution = substitutedType(object, substitutions);
  if (substitution !== null) {
    return indexedValueResolvesToUnknown(
      substitution.type,
      indexType,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(object);
  const indexDomain = resolvePropertyKeyDomain(
    indexType.type,
    indexType.environment,
    indexType.substitutions,
    indexType.resolveImportedType,
    resolving,
  );
  if (
    (name === "Array" || name === "ReadonlyArray") &&
    isBuiltInType(name, environment) &&
    propertyKeyDomainIncludes(
      {
        numbers: true,
        patterns: [],
        strings: false,
        symbols: false,
        values: new Set(),
      },
      indexDomain,
    )
  ) {
    const value = object.typeArguments?.params[0];
    return (
      value !== undefined &&
      typeResolvesToUnknownWithState(
        value,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    );
  }
  if (name === "Record" && isBuiltInType(name, environment)) {
    const [key, value] = object.typeArguments?.params ?? [];
    return (
      key !== undefined &&
      value !== undefined &&
      propertyKeyDomainIncludes(
        resolvePropertyKeyDomain(key, environment, substitutions, resolveImportedType, resolving),
        indexDomain,
      ) &&
      typeResolvesToUnknownWithState(
        value,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    );
  }
  return resolveTypeReference(object, environment, substitutions, resolveImportedType).some(
    (resolved) => {
      if (resolved.kind !== "alias") return false;
      const state = resolvedAliasState(resolved, resolving, "indexed-unknown");
      return (
        state !== null &&
        indexedValueResolvesToUnknown(
          resolved.declaration.typeAnnotation,
          indexType,
          resolved.environment,
          state.substitutions,
          state.resolving,
          resolved.resolveImportedType,
        )
      );
    },
  );
}

export function typeResolvesToAny(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return typeResolvesToAnyWithState(type, environment, new Map(), new Set(), resolveImportedType);
}

function typeResolvesToAnyWithState(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSAnyKeyword") return true;
  if (unwrapped.type === "TSUnionType" || unwrapped.type === "TSIntersectionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToAnyWithState(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const substitution = substitutedType(unwrapped, substitutions);
  if (substitution !== null) {
    return typeResolvesToAnyWithState(
      substitution.type,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(unwrapped);
  if ((name === "Promise" || name === "PromiseLike") && isBuiltInType(name, environment)) {
    const value = unwrapped.typeArguments?.params[0];
    return (
      value !== undefined &&
      typeResolvesToAnyWithState(value, environment, substitutions, resolving, resolveImportedType)
    );
  }
  return resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).some(
    (resolved) => {
      if (resolved.kind !== "alias") return false;
      const state = resolvedAliasState(resolved, resolving, "any");
      return (
        state !== null &&
        typeResolvesToAnyWithState(
          resolved.declaration.typeAnnotation,
          resolved.environment,
          state.substitutions,
          state.resolving,
          resolved.resolveImportedType,
        )
      );
    },
  );
}

export function typeResolvesToUnknown(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return typeResolvesToUnknownWithState(
    type,
    environment,
    new Map(),
    new Set(),
    resolveImportedType,
  );
}

function typeResolvesToUnknownWithState(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return true;
  if (unwrapped.type === "TSIndexedAccessType") {
    return indexedValueResolvesToUnknown(
      unwrapped.objectType,
      {
        environment,
        resolveImportedType,
        substitutions,
        type: unwrapped.indexType,
      },
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) =>
      typeResolvesToUnknownWithState(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    );
  }
  if (unwrapped.type === "TSIntersectionType") {
    return unwrapped.types.every((member) =>
      typeResolvesToUnknownWithState(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const substitution = substitutedType(unwrapped, substitutions);
  if (substitution !== null) {
    return typeResolvesToUnknownWithState(
      substitution.type,
      substitution.environment,
      substitution.substitutions,
      resolving,
      substitution.resolveImportedType,
    );
  }
  const name = typeReferenceName(unwrapped);
  if ((name === "Promise" || name === "PromiseLike") && isBuiltInType(name, environment)) {
    const value = unwrapped.typeArguments?.params[0];
    return (
      value !== undefined &&
      typeResolvesToUnknownWithState(
        value,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    );
  }
  return resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).some(
    (resolved) => {
      if (resolved.kind !== "alias") return false;
      const state = resolvedAliasState(resolved, resolving, "unknown");
      return (
        state !== null &&
        typeResolvesToUnknownWithState(
          resolved.declaration.typeAnnotation,
          resolved.environment,
          state.substitutions,
          state.resolving,
          resolved.resolveImportedType,
        )
      );
    },
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
