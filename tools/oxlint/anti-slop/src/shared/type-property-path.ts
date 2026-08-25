import type {
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSType,
  PortableTSTupleElement,
} from "./portable-ast.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  expressionTypeNameParts,
  isBroadPropertyKey,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveInterfaceHeritage,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeParameterSubstitution,
  typeReferenceName,
  unwrapTransparentType,
  type ResolvedWideningType,
  type TypeSubstitutions,
  type WideningTypeArgument,
  type WideningTypeEnvironment,
  type WideningTypeResolver,
} from "./portable-type-resolution.ts";

export type TypePropertyPathSegment = number | string;

type TypePathResolution = "absent" | "known" | "unknown";

function unionPathResolution(results: readonly TypePathResolution[]): TypePathResolution {
  if (results.includes("unknown")) return "unknown";
  return results.includes("known") ? "known" : "absent";
}

function intersectionPathResolution(results: readonly TypePathResolution[]): TypePathResolution {
  if (results.includes("known")) return "known";
  return results.includes("unknown") ? "unknown" : "absent";
}

function memberKeyName(key: PortableNode): string | null {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    return String(key.value);
  }
  return null;
}

function tupleElementType(element: PortableTSTupleElement): PortableTSType {
  if (element.type === "TSOptionalType" || element.type === "TSRestType") {
    return element.typeAnnotation;
  }
  return element.type === "TSNamedTupleMember" ? tupleElementType(element.elementType) : element;
}

function tupleTypeAtIndex(
  elements: readonly PortableTSTupleElement[],
  index: number,
): PortableTSType | null {
  for (const [elementIndex, element] of elements.entries()) {
    if (element.type === "TSRestType" && index >= elementIndex) {
      const restType = unwrapTransparentType(element.typeAnnotation);
      return restType.type === "TSArrayType" ? restType.elementType : restType;
    }
    if (elementIndex === index) return tupleElementType(element);
  }
  return null;
}

function literalKeyMatches(type: PortableTSType, segment: TypePropertyPathSegment): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) => literalKeyMatches(member, segment));
  }
  if (unwrapped.type !== "TSLiteralType") return false;
  const literal = unwrapped.literal;
  return (
    literal.type === "Literal" &&
    (typeof literal.value === "string" || typeof literal.value === "number") &&
    String(literal.value) === String(segment)
  );
}

function propertyKeyMatches(
  type: PortableTSType,
  segment: TypePropertyPathSegment,
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: WideningTypeResolver,
): boolean {
  return (
    isBroadPropertyKey(type, environment, substitutions, resolveImportedType, resolving) ||
    literalKeyMatches(type, segment)
  );
}

function typeMembersPathResolution(
  members: readonly PortableNode[],
  path: readonly TypePropertyPathSegment[],
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: WideningTypeResolver,
): TypePathResolution {
  const [segment, ...rest] = path;
  if (segment === undefined) return "known";
  const direct = members.flatMap((member): readonly TypePathResolution[] => {
    if (
      member.type !== "TSPropertySignature" ||
      member.typeAnnotation === null ||
      memberKeyName(member.key) !== String(segment)
    ) {
      return [];
    }
    return [
      typePathResolution(
        member.typeAnnotation.typeAnnotation,
        rest,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    ];
  });
  if (direct.length > 0) return intersectionPathResolution(direct);
  const indexed = members.flatMap((member): readonly TypePathResolution[] => {
    if (member.type !== "TSIndexSignature") return [];
    const keyType = member.parameters[0]?.typeAnnotation.typeAnnotation;
    if (
      keyType === undefined ||
      !propertyKeyMatches(
        keyType,
        segment,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    ) {
      return [];
    }
    return [
      typePathResolution(
        member.typeAnnotation.typeAnnotation,
        rest,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    ];
  });
  return intersectionPathResolution(indexed);
}

function resolvedTypePathResolution(
  resolved: ResolvedWideningType,
  path: readonly TypePropertyPathSegment[],
  resolving: ReadonlySet<string>,
  baseSubstitutions: TypeSubstitutions,
): TypePathResolution {
  const nextResolving = enterTypeResolution(resolving, resolved.key, `path\0${path.join("\0")}`);
  if (nextResolving === null) return "absent";
  if (resolved.kind === "interface") {
    return interfaceTypePathResolution(
      resolved.declarations,
      resolved.environment,
      resolved.arguments,
      path,
      resolved.resolveImportedType,
      nextResolving,
    );
  }
  const substitutions = aliasSubstitution(
    resolved.declaration,
    resolved.arguments,
    resolved.environment,
    baseSubstitutions,
  );
  return substitutions === null
    ? "absent"
    : typePathResolution(
        resolved.declaration.typeAnnotation,
        path,
        resolved.environment,
        substitutions,
        nextResolving,
        resolved.resolveImportedType,
      );
}

function interfaceTypePathResolution(
  declarations: readonly PortableTSInterfaceDeclaration[],
  environment: WideningTypeEnvironment,
  arguments_: readonly WideningTypeArgument[],
  path: readonly TypePropertyPathSegment[],
  resolveImportedType: WideningTypeResolver | undefined,
  resolving: ReadonlySet<string>,
): TypePathResolution {
  const results: TypePathResolution[] = [];
  for (const declaration of declarations) {
    const substitutions = typeParameterSubstitution(
      declaration.typeParameters?.params ?? [],
      arguments_,
      environment,
      new Map(),
    );
    if (substitutions === null) continue;
    const direct = typeMembersPathResolution(
      declaration.body.body,
      path,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
    if (direct !== "absent") results.push(direct);
    for (const heritage of declaration.extends) {
      const heritageParts = expressionTypeNameParts(heritage.expression);
      const heritageName = heritageParts.length === 1 ? heritageParts[0] : undefined;
      if (heritageName === "Record" && isBuiltInType(heritageName, environment)) {
        const [keyType, valueType] = heritage.typeArguments?.params ?? [];
        const [segment, ...rest] = path;
        if (
          segment !== undefined &&
          keyType !== undefined &&
          valueType !== undefined &&
          propertyKeyMatches(
            keyType,
            segment,
            environment,
            substitutions,
            resolving,
            resolveImportedType,
          )
        ) {
          results.push(
            typePathResolution(
              valueType,
              rest,
              environment,
              substitutions,
              resolving,
              resolveImportedType,
            ),
          );
        }
        continue;
      }
      for (const resolved of resolveInterfaceHeritage(
        heritage,
        environment,
        substitutions,
        resolveImportedType,
      )) {
        results.push(resolvedTypePathResolution(resolved, path, resolving, substitutions));
      }
    }
  }
  return intersectionPathResolution(results);
}

function builtInReferencePathResolution(
  type: Extract<PortableTSType, { type: "TSTypeReference" }>,
  path: readonly TypePropertyPathSegment[],
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: WideningTypeResolver,
): TypePathResolution | null {
  const name = typeReferenceName(type);
  if (name === null || !isBuiltInType(name, environment)) return null;
  const arguments_ = type.typeArguments?.params ?? [];
  if (TRANSPARENT_TYPE_WRAPPERS.has(name)) {
    const wrapped = arguments_[0];
    return wrapped === undefined
      ? "absent"
      : typePathResolution(
          wrapped,
          path,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        );
  }
  const [segment, ...rest] = path;
  if (name === "Record") {
    const [keyType, valueType] = arguments_;
    return segment === undefined ||
      keyType === undefined ||
      valueType === undefined ||
      !propertyKeyMatches(
        keyType,
        segment,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
      ? "absent"
      : typePathResolution(
          valueType,
          rest,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        );
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const elementType = arguments_[0];
    return typeof segment !== "number" || elementType === undefined
      ? "absent"
      : typePathResolution(
          elementType,
          rest,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        );
  }
  if (name === "Pick") {
    const [sourceType, selectedKeys] = arguments_;
    return segment === undefined ||
      sourceType === undefined ||
      selectedKeys === undefined ||
      !propertyKeyMatches(
        selectedKeys,
        segment,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
      ? "absent"
      : typePathResolution(
          sourceType,
          path,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        );
  }
  return null;
}

function typePathResolution(
  type: PortableTSType,
  path: readonly TypePropertyPathSegment[],
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: WideningTypeResolver,
): TypePathResolution {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnionType") {
    return unionPathResolution(
      unwrapped.types.map((member) =>
        typePathResolution(
          member,
          path,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSIntersectionType") {
    return intersectionPathResolution(
      unwrapped.types.map((member) =>
        typePathResolution(
          member,
          path,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSTypeReference") {
    const simpleName = typeReferenceName(unwrapped);
    if (simpleName !== null) {
      const substitution = substitutions.get(simpleName);
      if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, simpleName)) {
        return typePathResolution(
          substitution.type,
          path,
          substitution.environment,
          substitutions,
          resolving,
          resolveImportedType,
        );
      }
    }
    const builtIn = builtInReferencePathResolution(
      unwrapped,
      path,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
    if (builtIn !== null) return builtIn;
    const results = resolveTypeReference(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
    ).map((resolved) => resolvedTypePathResolution(resolved, path, resolving, substitutions));
    return intersectionPathResolution(results);
  }
  if (path.length === 0) return unwrapped.type === "TSUnknownKeyword" ? "unknown" : "known";
  if (unwrapped.type === "TSTypeLiteral") {
    return typeMembersPathResolution(
      unwrapped.members,
      path,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
  }
  if (unwrapped.type === "TSMappedType") {
    const [segment, ...rest] = path;
    if (
      segment === undefined ||
      unwrapped.typeAnnotation === null ||
      !propertyKeyMatches(
        unwrapped.constraint,
        segment,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      )
    ) {
      return "absent";
    }
    return typePathResolution(
      unwrapped.typeAnnotation,
      rest,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
  }
  const [segment, ...rest] = path;
  if (typeof segment !== "number") return "absent";
  if (unwrapped.type === "TSArrayType") {
    return typePathResolution(
      unwrapped.elementType,
      rest,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
  }
  if (unwrapped.type !== "TSTupleType") return "absent";
  const elementType = tupleTypeAtIndex(unwrapped.elementTypes, segment);
  return elementType === null
    ? "absent"
    : typePathResolution(
        elementType,
        rest,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      );
}

/** Resolve whether a destructuring path reaches an explicit unknown type. */
export function typePropertyPathResolvesToUnknown(
  type: PortableTSType,
  path: readonly TypePropertyPathSegment[],
  environment: WideningTypeEnvironment,
  resolveImportedType?: WideningTypeResolver,
): boolean {
  return (
    typePathResolution(type, path, environment, new Map(), new Set(), resolveImportedType) ===
    "unknown"
  );
}
