import type { PortableTSType } from "./portable-ast.ts";
import {
  intersectPropertyKeyDomains,
  propertyKeyDomainIncludes,
  propertyKeyDomainIsEmpty,
  propertyKeyDomainIsExact,
  unionPropertyKeyDomains,
  type PropertyKeyDomain,
} from "./property-key-domain-model.ts";
import type {
  PortableTypeEnvironment,
  PortableTypeResolver,
  TypeSubstitutions,
} from "./portable-type-resolution.ts";
import type { TypePropertyDomainPath } from "./tuple-type-path.ts";

export type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving?: ReadonlySet<string>,
  keyDomainSubstitutions?: ReadonlyMap<string, PropertyKeyDomain>,
) => PropertyKeyDomain;

export type TypeLeafClassification = { readonly kind: "any" | "never" | "other" };
export type TypePropertyLeaf = {
  readonly classification?: TypeLeafClassification;
  readonly domain: PropertyKeyDomain;
};

export type QualifiedPropertyKeyResolution =
  | { readonly found: false }
  | {
      readonly classification?: TypeLeafClassification;
      readonly definite: boolean;
      readonly found: true;
      readonly value: PropertyKeyDomain;
    };

export type TypePropertyKeyDomainResolver = (
  type: PortableTSType,
  path: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveLeaf?: TypePropertyLeafResolver,
) => QualifiedPropertyKeyResolution;

export type TypePropertyLeafResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving?: ReadonlySet<string>,
  keyDomainSubstitutions?: ReadonlyMap<string, PropertyKeyDomain>,
) => TypePropertyLeaf;

export const absentProperty = (): QualifiedPropertyKeyResolution => ({ found: false });

export const foundProperty = (
  value: PropertyKeyDomain,
  definite = true,
  classification?: TypeLeafClassification,
): QualifiedPropertyKeyResolution =>
  classification === undefined
    ? { definite, found: true, value }
    : { classification, definite, found: true, value };

function unionLeafClassifications(
  classifications: readonly TypeLeafClassification[],
): TypeLeafClassification | undefined {
  if (classifications.length === 0) return undefined;
  if (classifications.some(({ kind }) => kind === "any")) return { kind: "any" };
  return classifications.some(({ kind }) => kind === "other")
    ? { kind: "other" }
    : { kind: "never" };
}

function intersectLeafClassifications(
  classifications: readonly TypeLeafClassification[],
): TypeLeafClassification | undefined {
  if (classifications.length === 0) return undefined;
  if (classifications.some(({ kind }) => kind === "never")) return { kind: "never" };
  return classifications.some(({ kind }) => kind === "any") ? { kind: "any" } : { kind: "other" };
}

export function unionPropertyKeyResolutions(
  resolutions: readonly QualifiedPropertyKeyResolution[],
): QualifiedPropertyKeyResolution {
  const found = resolutions.filter((resolution) => resolution.found);
  return found.length === 0
    ? absentProperty()
    : foundProperty(
        unionPropertyKeyDomains(found.map((resolution) => resolution.value)),
        resolutions.length > 0 &&
          resolutions.every((resolution) => resolution.found && resolution.definite),
        unionLeafClassifications(
          found.flatMap((resolution) =>
            resolution.classification === undefined ? [] : [resolution.classification],
          ),
        ),
      );
}

export function intersectPropertyKeyResolutions(
  resolutions: readonly QualifiedPropertyKeyResolution[],
): QualifiedPropertyKeyResolution {
  const found = resolutions.filter((resolution) => resolution.found);
  const [first, ...rest] = found;
  return first === undefined
    ? absentProperty()
    : foundProperty(
        rest.reduce(
          (domain, resolution) => intersectPropertyKeyDomains(domain, resolution.value),
          first.value,
        ),
        found.some((resolution) => resolution.definite),
        intersectLeafClassifications(
          found.flatMap((resolution) =>
            resolution.classification === undefined ? [] : [resolution.classification],
          ),
        ),
      );
}

/** Test whether a TypeScript property lookup can select a declared key domain. */
export function propertyKeyLookupOverlaps(
  lookupDomain: PropertyKeyDomain,
  declaredDomain: PropertyKeyDomain,
): boolean {
  if (propertyKeyDomainIsEmpty(lookupDomain) || propertyKeyDomainIsEmpty(declaredDomain)) {
    return false;
  }
  if (propertyKeyDomainIncludes(declaredDomain, lookupDomain)) return true;
  if (propertyKeyDomainIsExact(declaredDomain)) {
    return propertyKeyDomainIncludes(lookupDomain, declaredDomain);
  }
  if (propertyKeyDomainIsExact(lookupDomain)) return false;
  return !propertyKeyDomainIsEmpty(intersectPropertyKeyDomains(lookupDomain, declaredDomain));
}
