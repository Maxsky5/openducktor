import type { PortableTSType, PortableTSTupleElement } from "./portable-ast.ts";
import {
  propertyKeyDomainConcreteValues,
  propertyKeyDomainIncludes,
  type PropertyKeyDomain,
} from "./property-key-domain-model.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveTypeReference,
  typeReferenceName,
  unwrapTransparentType,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";

export type TypePathResolution = "absent" | "known" | "unknown";

export type TypePropertyDomainPathSegment =
  | PropertyKeyDomain
  | { readonly kind: "array-rest"; readonly offset: number };

export type TypePropertyDomainPath = readonly TypePropertyDomainPathSegment[];

export type TypePathResolver<Result> = (
  type: PortableTSType,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
) => Result;

export const numberPropertyKeyDomain: PropertyKeyDomain = {
  numbers: true,
  patterns: [],
  strings: false,
  symbols: false,
  unknown: false,
  uniqueSymbols: new Set(),
  values: new Set(),
};

type TupleLayoutElement =
  | { readonly kind: "fixed"; readonly type: PortableTSType }
  | { readonly kind: "rest"; readonly type: PortableTSType };

function tupleElementType(element: PortableTSTupleElement): PortableTSType {
  if (element.type === "TSOptionalType" || element.type === "TSRestType") {
    return element.typeAnnotation;
  }
  return element.type === "TSNamedTupleMember" ? tupleElementType(element.elementType) : element;
}

function tupleRestType(element: PortableTSTupleElement): PortableTSType | null {
  if (element.type === "TSNamedTupleMember") return tupleRestType(element.elementType);
  return element.type === "TSRestType" ? element.typeAnnotation : null;
}

function finiteTupleRestAlternatives(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
): readonly (readonly TupleLayoutElement[])[] | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnionType") {
    const alternatives = unwrapped.types.map((member) =>
      finiteTupleRestAlternatives(
        member,
        environment,
        substitutions,
        resolving,
        resolveImportedType,
      ),
    );
    return alternatives.some((alternative) => alternative === null)
      ? null
      : alternatives.flatMap((alternative) => alternative ?? []);
  }
  if (unwrapped.type === "TSTupleType") {
    return expandFiniteTupleRests(
      unwrapped.elementTypes,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    );
  }
  if (unwrapped.type === "TSArrayType") {
    return [[{ kind: "rest", type: unwrapped }]];
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return finiteTupleRestAlternatives(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        resolving,
        substitution.resolveImportedType,
      );
    }
    if (
      (name === "Array" || name === "ReadonlyArray") &&
      isBuiltInType(name, environment) &&
      unwrapped.typeArguments?.params[0] !== undefined
    ) {
      return [[{ kind: "rest", type: unwrapped }]];
    }
  }
  const alternatives: (readonly TupleLayoutElement[])[] = [];
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    if (resolved.kind !== "alias") continue;
    const nextResolving = enterTypeResolution(resolving, resolved.key, "tuple-rest");
    if (nextResolving === null) continue;
    const aliasSubstitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (aliasSubstitutions === null) continue;
    const resolvedAlternatives = finiteTupleRestAlternatives(
      resolved.declaration.typeAnnotation,
      resolved.environment,
      aliasSubstitutions,
      nextResolving,
      resolved.resolveImportedType,
    );
    if (resolvedAlternatives !== null) alternatives.push(...resolvedAlternatives);
  }
  return alternatives.length === 0 ? null : alternatives;
}

function expandFiniteTupleRests(
  elements: readonly PortableTSTupleElement[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
): readonly (readonly TupleLayoutElement[])[] {
  let alternatives: readonly (readonly TupleLayoutElement[])[] = [[]];
  for (const element of elements) {
    const restType = tupleRestType(element);
    const expansions: readonly (readonly TupleLayoutElement[])[] =
      restType !== null
        ? (finiteTupleRestAlternatives(
            restType,
            environment,
            substitutions,
            resolving,
            resolveImportedType,
          ) ?? [[{ kind: "rest", type: restType }]])
        : [[{ kind: "fixed", type: tupleElementType(element) }]];
    alternatives = alternatives.flatMap((prefix) =>
      expansions.map((expansion) => [...prefix, ...expansion]),
    );
  }
  return alternatives;
}

function tupleTypesAtIndex(
  elements: readonly TupleLayoutElement[],
  index: number,
): readonly TupleLayoutElement[] {
  for (const [elementIndex, element] of elements.entries()) {
    if (element.kind === "rest" && index >= elementIndex) {
      const possibleTypes: TupleLayoutElement[] = [element];
      for (let trailingIndex = elementIndex + 1; trailingIndex < elements.length; trailingIndex++) {
        if (index >= trailingIndex - 1) {
          const trailing = elements[trailingIndex];
          if (trailing !== undefined) possibleTypes.push(trailing);
        }
      }
      return possibleTypes;
    }
    if (elementIndex === index) return [element];
  }
  return [];
}

function tupleIndex(segment: PropertyKeyDomain): number | null {
  const values = propertyKeyDomainConcreteValues(segment);
  if (values.length !== 1) return null;
  const value = values[0];
  const text = String(value);
  const index = Number(text);
  return Number.isInteger(index) && index >= 0 && String(index) === text ? index : null;
}

function unionPathResolution(results: readonly TypePathResolution[]): TypePathResolution {
  if (results.includes("unknown")) return "unknown";
  return results.includes("known") ? "known" : "absent";
}

function tupleLayoutElementPathResolution<Result>(
  element: TupleLayoutElement,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvePath: TypePathResolver<Result>,
): Result {
  return resolvePath(
    element.type,
    element.kind === "rest" ? [numberPropertyKeyDomain, ...path] : path,
    environment,
    substitutions,
    resolving,
    resolveImportedType,
    keyDomainSubstitutions,
  );
}

export function resolveTupleTypePathWith<Result>(
  type: Extract<PortableTSType, { type: "TSTupleType" }>,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvePath: TypePathResolver<Result>,
  unionResults: (results: readonly Result[]) => Result,
  absent: Result,
): Result {
  const [segment, ...rest] = path;
  if (segment !== undefined && "kind" in segment) {
    return resolveTupleRestTypePathWith(
      type,
      segment.offset,
      rest,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
      keyDomainSubstitutions,
      resolvePath,
      unionResults,
      absent,
    );
  }
  if (segment === undefined || !propertyKeyDomainIncludes(numberPropertyKeyDomain, segment)) {
    return absent;
  }
  const tupleAlternatives = expandFiniteTupleRests(
    type.elementTypes,
    environment,
    substitutions,
    resolving,
    resolveImportedType,
  );
  if (segment.numbers) {
    return unionResults(
      tupleAlternatives.flatMap((elements) =>
        elements.map((element) =>
          tupleLayoutElementPathResolution(
            element,
            rest,
            environment,
            substitutions,
            resolving,
            resolveImportedType,
            keyDomainSubstitutions,
            resolvePath,
          ),
        ),
      ),
    );
  }
  const index = tupleIndex(segment);
  if (index === null) return absent;
  return unionResults(
    tupleAlternatives.flatMap((elements) =>
      tupleTypesAtIndex(elements, index).map((element) =>
        tupleLayoutElementPathResolution(
          element,
          rest,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
          keyDomainSubstitutions,
          resolvePath,
        ),
      ),
    ),
  );
}

export function resolveTupleTypePath(
  type: Extract<PortableTSType, { type: "TSTupleType" }>,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvePath: TypePathResolver<TypePathResolution>,
): TypePathResolution {
  return resolveTupleTypePathWith(
    type,
    path,
    environment,
    substitutions,
    resolving,
    resolveImportedType,
    keyDomainSubstitutions,
    resolvePath,
    unionPathResolution,
    "absent",
  );
}

function tupleElementsAtOrAfter(
  elements: readonly TupleLayoutElement[],
  offset: number,
): readonly TupleLayoutElement[] {
  return elements.filter((element, index) => index >= offset || element.kind === "rest");
}

export function resolveTupleRestTypePathWith<Result>(
  type: Extract<PortableTSType, { type: "TSTupleType" }>,
  offset: number,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvePath: TypePathResolver<Result>,
  unionResults: (results: readonly Result[]) => Result,
  absent: Result,
): Result {
  const [segment, ...rest] = path;
  if (
    segment === undefined ||
    "kind" in segment ||
    !propertyKeyDomainIncludes(numberPropertyKeyDomain, segment)
  ) {
    return absent;
  }
  const tupleAlternatives = expandFiniteTupleRests(
    type.elementTypes,
    environment,
    substitutions,
    resolving,
    resolveImportedType,
  );
  if (segment.numbers) {
    return unionResults(
      tupleAlternatives.flatMap((elements) =>
        tupleElementsAtOrAfter(elements, offset).map((element) =>
          tupleLayoutElementPathResolution(
            element,
            rest,
            environment,
            substitutions,
            resolving,
            resolveImportedType,
            keyDomainSubstitutions,
            resolvePath,
          ),
        ),
      ),
    );
  }
  const index = tupleIndex(segment);
  if (index === null) return absent;
  return unionResults(
    tupleAlternatives.flatMap((elements) =>
      tupleTypesAtIndex(elements, offset + index).map((element) =>
        tupleLayoutElementPathResolution(
          element,
          rest,
          environment,
          substitutions,
          resolving,
          resolveImportedType,
          keyDomainSubstitutions,
          resolvePath,
        ),
      ),
    ),
  );
}
