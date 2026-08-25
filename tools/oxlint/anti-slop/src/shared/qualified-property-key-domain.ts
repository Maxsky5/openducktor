import type { PortableNode, PortableTSType } from "./portable-ast.ts";
import {
  resolveMappedSourceKeyDomains,
  resolveObjectPropertyKeyDomain,
  portablePropertyKeyValue,
} from "./keyof-property-key-domain.ts";
import {
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  propertyKeyDomainFromValue,
  propertyKeyDomainIncludes,
  propertyKeyDomainIsExact,
  subtractPropertyKeyDomains,
  type PropertyKeyDomain,
} from "./property-key-domain-model.ts";
import {
  absentProperty,
  foundProperty,
  intersectPropertyKeyResolutions,
  propertyKeyLookupOverlaps,
  unionPropertyKeyResolutions,
  type PropertyKeyDomainResolver,
  type QualifiedPropertyKeyResolution,
  type TypePropertyLeafResolver,
  type TypePropertyKeyDomainResolver,
} from "./qualified-property-key-model.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  expressionTypeNameParts,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveInterfaceHeritage,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeParameterSubstitution,
  typeReferenceName,
  unwrapTransparentType,
  withoutVisibleTypeName,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type PortableValueProjectionSegment,
  type ResolvedPortableType,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";
import {
  numberPropertyKeyDomain,
  resolveTupleTypePathWith,
  type TypePropertyDomainPath,
} from "./tuple-type-path.ts";
import { resolveUniqueSymbolReferenceDomain } from "./unique-symbol-property-key-domain.ts";
import { resolveTypeQueryPropertyKeyPath } from "./property-key-type-query.ts";

export type {
  PropertyKeyDomainResolver,
  QualifiedPropertyKeyResolution,
} from "./qualified-property-key-model.ts";

function pathSegmentKey(segment: TypePropertyDomainPath[number]): string {
  if ("kind" in segment) return `rest:${segment.offset}`;
  return JSON.stringify({
    numbers: segment.numbers,
    patterns: segment.patterns,
    strings: segment.strings,
    symbols: segment.symbols,
    unknown: segment.unknown,
    uniqueSymbols: [...segment.uniqueSymbols].sort(),
    values: [...segment.values].sort(),
  });
}

function memberKeyDomain(
  member: Extract<PortableNode, { type: "TSPropertySignature" }>,
  environment: PortableTypeEnvironment,
  resolveImportedType: PortableTypeResolver | undefined,
): PropertyKeyDomain {
  if (member.computed) {
    const parts = expressionTypeNameParts(member.key);
    if (parts.length > 0) {
      return resolveUniqueSymbolReferenceDomain(
        { kind: "name", parts },
        environment,
        resolveImportedType,
      );
    }
  }
  const value = portablePropertyKeyValue(member.key);
  return value === null ? emptyPropertyKeyDomain() : propertyKeyDomainFromValue(value);
}

type IndexSignatureCandidate = {
  readonly keyDomain: PropertyKeyDomain;
  readonly member: Extract<PortableNode, { type: "TSIndexSignature" }>;
};

function mostSpecificIndexSignatures(
  candidates: readonly IndexSignatureCandidate[],
): readonly IndexSignatureCandidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          propertyKeyDomainIncludes(candidate.keyDomain, other.keyDomain) &&
          !propertyKeyDomainIncludes(other.keyDomain, candidate.keyDomain),
      ),
  );
}

function resolveMembersPath(
  members: readonly PortableNode[],
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveLeafDomain: TypePropertyLeafResolver,
): QualifiedPropertyKeyResolution {
  const [segment, ...rest] = path;
  if (segment === undefined) return foundProperty(emptyPropertyKeyDomain());
  if ("kind" in segment) return absentProperty();
  const direct = members.flatMap((member): readonly QualifiedPropertyKeyResolution[] => {
    if (member.type !== "TSPropertySignature" || member.typeAnnotation === null) return [];
    const keyDomain = memberKeyDomain(member, environment, resolveImportedType);
    if (!propertyKeyLookupOverlaps(segment, keyDomain)) return [];
    const resolution = resolveTypePropertyKeyDomain(
      member.typeAnnotation.typeAnnotation,
      rest,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveLeafDomain,
    );
    return resolution.found
      ? [{ ...resolution, definite: resolution.definite && member.optional !== true }]
      : [];
  });
  const exactSegment = propertyKeyDomainIsExact(segment);
  const directResolution = exactSegment
    ? intersectPropertyKeyResolutions(direct)
    : unionPropertyKeyResolutions(direct);
  if (direct.length > 0 && exactSegment) return directResolution;
  const indexCandidates = members.flatMap((member): readonly IndexSignatureCandidate[] => {
    if (member.type !== "TSIndexSignature") return [];
    const keyType = member.parameters[0]?.typeAnnotation.typeAnnotation;
    if (keyType === undefined) return [];
    const keyDomain = resolveDomain(
      keyType,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
    return propertyKeyLookupOverlaps(segment, keyDomain) ? [{ keyDomain, member }] : [];
  });
  const indexed = mostSpecificIndexSignatures(indexCandidates).map(({ member }) => {
    const resolution = resolveTypePropertyKeyDomain(
      member.typeAnnotation.typeAnnotation,
      rest,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveLeafDomain,
    );
    return resolution.found ? { ...resolution, definite: false } : resolution;
  });
  const indexedResolution = intersectPropertyKeyResolutions(indexed);
  return direct.length === 0
    ? indexedResolution
    : unionPropertyKeyResolutions([directResolution, indexedResolution]);
}

function resolveResolvedPath(
  resolved: ResolvedPortableType,
  path: TypePropertyDomainPath,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveLeafDomain: TypePropertyLeafResolver,
): QualifiedPropertyKeyResolution {
  const nextResolving = enterTypeResolution(
    resolving,
    resolved.key,
    `property-path\0${path.map(pathSegmentKey).join("\0")}`,
  );
  if (nextResolving === null) return absentProperty();
  if (resolved.kind === "alias") {
    const substitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    return substitutions === null
      ? absentProperty()
      : resolveTypePropertyKeyDomain(
          resolved.declaration.typeAnnotation,
          path,
          resolved.environment,
          substitutions,
          resolved.resolveImportedType,
          nextResolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
  }
  const results: QualifiedPropertyKeyResolution[] = [];
  for (const declaration of resolved.declarations) {
    const substitutions = typeParameterSubstitution(
      declaration.typeParameters?.params ?? [],
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (substitutions === null) continue;
    const direct = resolveMembersPath(
      declaration.body.body,
      path,
      resolved.environment,
      substitutions,
      resolved.resolveImportedType,
      nextResolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveLeafDomain,
    );
    if (direct.found) results.push(direct);
    for (const heritage of declaration.extends) {
      const heritageParts = expressionTypeNameParts(heritage.expression);
      const heritageName = heritageParts.length === 1 ? heritageParts[0] : undefined;
      const builtIn =
        heritageName === undefined
          ? null
          : resolveBuiltInPath(
              heritageName,
              heritage.typeArguments?.params ?? [],
              path,
              resolved.environment,
              substitutions,
              resolved.resolveImportedType,
              nextResolving,
              keyDomainSubstitutions,
              resolveDomain,
              resolveLeafDomain,
            );
      if (builtIn !== null) {
        results.push(builtIn);
        continue;
      }
      for (const parent of resolveInterfaceHeritage(
        heritage,
        resolved.environment,
        substitutions,
        resolved.resolveImportedType,
      )) {
        results.push(
          resolveResolvedPath(
            parent,
            path,
            nextResolving,
            keyDomainSubstitutions,
            resolveDomain,
            resolveLeafDomain,
          ),
        );
      }
    }
  }
  return intersectPropertyKeyResolutions(results);
}

function resolveBuiltInPath(
  name: string,
  arguments_: readonly PortableTSType[],
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveLeafDomain: TypePropertyLeafResolver,
): QualifiedPropertyKeyResolution | null {
  if (!isBuiltInType(name, environment)) return null;
  if (TRANSPARENT_TYPE_WRAPPERS.has(name)) {
    const wrapped = arguments_[0];
    return wrapped === undefined
      ? absentProperty()
      : resolveTypePropertyKeyDomain(
          wrapped,
          path,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
  }
  const [segment, ...rest] = path;
  if (segment === undefined || "kind" in segment) return null;
  if (name === "Record") {
    const [keyType, valueType] = arguments_;
    if (keyType === undefined || valueType === undefined) return absentProperty();
    const keyDomain = resolveDomain(
      keyType,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
    return !propertyKeyLookupOverlaps(segment, keyDomain)
      ? absentProperty()
      : resolveTypePropertyKeyDomain(
          valueType,
          rest,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const elementType = arguments_[0];
    return elementType === undefined || !propertyKeyLookupOverlaps(segment, numberPropertyKeyDomain)
      ? absentProperty()
      : resolveTypePropertyKeyDomain(
          elementType,
          rest,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
  }
  if (name !== "Pick" && name !== "Omit") return null;
  const [sourceType, selectedKeys] = arguments_;
  if (sourceType === undefined || selectedKeys === undefined) return absentProperty();
  const selectedDomain = resolveDomain(
    selectedKeys,
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
  );
  const sourceDomain = resolveObjectPropertyKeyDomain(
    sourceType,
    environment,
    substitutions,
    resolveImportedType,
    { keyDomainSubstitutions, resolving },
    resolveDomain,
  );
  const remainingDomain =
    name === "Pick"
      ? intersectPropertyKeyDomains(sourceDomain, selectedDomain)
      : subtractPropertyKeyDomains(sourceDomain, selectedDomain);
  return !propertyKeyLookupOverlaps(segment, remainingDomain)
    ? absentProperty()
    : resolveTypePropertyKeyDomain(
        sourceType,
        path,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolveDomain,
        resolveLeafDomain,
      );
}

export function resolveTypePropertyKeyDomain(
  type: PortableTSType,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveLeafDomain: TypePropertyLeafResolver = (...arguments_) => ({
    domain: resolveDomain(...arguments_),
  }),
): QualifiedPropertyKeyResolution {
  const unwrapped = unwrapTransparentType(type);
  const resolveNestedTypePath: TypePropertyKeyDomainResolver = (
    nestedType,
    nestedPath,
    nestedEnvironment,
    nestedSubstitutions,
    nestedResolveImportedType,
    nestedResolving,
    nestedKeyDomainSubstitutions,
    nestedResolveDomain,
    nestedResolveLeafDomain = resolveLeafDomain,
  ) =>
    resolveTypePropertyKeyDomain(
      nestedType,
      nestedPath,
      nestedEnvironment,
      nestedSubstitutions,
      nestedResolveImportedType,
      nestedResolving,
      nestedKeyDomainSubstitutions,
      nestedResolveDomain,
      nestedResolveLeafDomain,
    );
  if (unwrapped.type === "TSUnionType") {
    return unionPropertyKeyResolutions(
      unwrapped.types.map((member) =>
        resolveTypePropertyKeyDomain(
          member,
          path,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSIntersectionType") {
    return intersectPropertyKeyResolutions(
      unwrapped.types.map((member) =>
        resolveTypePropertyKeyDomain(
          member,
          path,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSTypeReference") {
    const name = typeReferenceName(unwrapped);
    if (name !== null) {
      const substitution = substitutions.get(name);
      if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
        return resolveTypePropertyKeyDomain(
          substitution.type,
          path,
          substitution.environment,
          substitution.substitutions,
          substitution.resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
      }
      const builtIn = resolveBuiltInPath(
        name,
        unwrapped.typeArguments?.params ?? [],
        path,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolveDomain,
        resolveLeafDomain,
      );
      if (builtIn !== null) return builtIn;
    }
    return intersectPropertyKeyResolutions(
      resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).map(
        (resolved) =>
          resolveResolvedPath(
            resolved,
            path,
            resolving,
            keyDomainSubstitutions,
            resolveDomain,
            resolveLeafDomain,
          ),
      ),
    );
  }
  if (unwrapped.type === "TSIndexedAccessType") {
    const segment = resolveDomain(
      unwrapped.indexType,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
    return resolveTypePropertyKeyDomain(
      unwrapped.objectType,
      [segment, ...path],
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveLeafDomain,
    );
  }
  if (unwrapped.type === "TSTypeQuery") {
    return resolveTypeQueryPropertyKeyPath(
      unwrapped,
      path,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveNestedTypePath,
    );
  }
  if (path.length === 0) {
    const leaf = resolveLeafDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
    return foundProperty(leaf.domain, true, leaf.classification);
  }
  if (unwrapped.type === "TSTypeLiteral") {
    return resolveMembersPath(
      unwrapped.members,
      path,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
      resolveLeafDomain,
    );
  }
  if (unwrapped.type === "TSMappedType") {
    const [segment, ...rest] = path;
    const annotation = unwrapped.typeAnnotation;
    if (segment === undefined || "kind" in segment || annotation === null) {
      return absentProperty();
    }
    const sourceKeys = resolveMappedSourceKeyDomains(
      unwrapped,
      segment,
      environment,
      substitutions,
      resolveImportedType,
      { keyDomainSubstitutions, resolving },
      resolveDomain,
    );
    const valueSubstitutions = new Map(substitutions);
    valueSubstitutions.delete(unwrapped.key.name);
    return unionPropertyKeyResolutions(
      sourceKeys.map((sourceKey) =>
        resolveTypePropertyKeyDomain(
          annotation,
          rest,
          withoutVisibleTypeName(environment, unwrapped.key.name),
          valueSubstitutions,
          resolveImportedType,
          resolving,
          new Map(keyDomainSubstitutions).set(unwrapped.key.name, sourceKey),
          resolveDomain,
          resolveLeafDomain,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSArrayType") {
    const [segment, ...rest] = path;
    if (segment !== undefined && "kind" in segment) {
      return resolveTypePropertyKeyDomain(
        unwrapped,
        rest,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolveDomain,
        resolveLeafDomain,
      );
    }
    return segment === undefined || !propertyKeyLookupOverlaps(segment, numberPropertyKeyDomain)
      ? absentProperty()
      : resolveTypePropertyKeyDomain(
          unwrapped.elementType,
          rest,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolveDomain,
          resolveLeafDomain,
        );
  }
  return unwrapped.type === "TSTupleType"
    ? resolveTupleTypePathWith(
        unwrapped,
        path,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
        keyDomainSubstitutions,
        (
          nestedType,
          nestedPath,
          nestedEnvironment,
          nestedSubstitutions,
          nestedResolving,
          nestedResolver,
          nestedKeySubstitutions,
        ) =>
          resolveTypePropertyKeyDomain(
            nestedType,
            nestedPath,
            nestedEnvironment,
            nestedSubstitutions,
            nestedResolver,
            nestedResolving,
            nestedKeySubstitutions,
            resolveDomain,
            resolveLeafDomain,
          ),
        unionPropertyKeyResolutions,
        absentProperty(),
      )
    : absentProperty();
}

function projectionPath(path: readonly PortableValueProjectionSegment[]): TypePropertyDomainPath {
  return path.map((segment) =>
    typeof segment === "object" ? segment : propertyKeyDomainFromValue(segment),
  );
}

export function resolveQualifiedPropertyKeyDomain(
  type: PortableTSType,
  propertyPath: readonly PortableValueProjectionSegment[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
): QualifiedPropertyKeyResolution {
  return resolveTypePropertyKeyDomain(
    type,
    projectionPath(propertyPath),
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
    resolveDomain,
  );
}
