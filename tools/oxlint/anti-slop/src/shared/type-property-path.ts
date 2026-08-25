import type { PortableTSType } from "./portable-ast.ts";
import {
  propertyKeyDomainFromValue,
  resolvePropertyKeyDomain,
  type PropertyKeyDomain,
} from "./property-key-domain.ts";
import { namedValuePropertyKeyDomain } from "./property-key-value-binding.ts";
import { resolveTypePropertyKeyDomain } from "./qualified-property-key-domain.ts";
import type {
  PortableTypeEnvironment,
  PortableTypeResolver,
  TypeSubstitutions,
  UniqueSymbolReference,
} from "./portable-type-resolution.ts";
import type { TypePathResolution, TypePropertyDomainPath } from "./tuple-type-path.ts";

export type TypePropertyPathSegment =
  | number
  | string
  | UniqueSymbolReference
  | { readonly kind: "array-rest"; readonly offset: number };

export type { TypePathResolution } from "./tuple-type-path.ts";

function resolutionState(
  resolution: ReturnType<typeof resolveTypePropertyKeyDomain>,
): TypePathResolution {
  if (!resolution.found) return "absent";
  return resolution.value.unknown ? "unknown" : "known";
}

function pathDomains(
  path: readonly TypePropertyPathSegment[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType: PortableTypeResolver | undefined,
): TypePropertyDomainPath {
  const keyDomainSubstitutions = new Map<string, PropertyKeyDomain>();
  return path.map((segment) =>
    typeof segment !== "object"
      ? propertyKeyDomainFromValue(segment)
      : segment.kind === "array-rest"
        ? segment
        : namedValuePropertyKeyDomain(
            segment,
            [],
            environment,
            substitutions,
            resolveImportedType,
            resolving,
            keyDomainSubstitutions,
            resolvePropertyKeyDomain,
            resolveTypePropertyKeyDomain,
          ),
  );
}

/** Resolve whether a destructuring path reaches an explicit unknown type. */
export function typePropertyPathResolvesToUnknown(
  type: PortableTSType,
  path: readonly TypePropertyPathSegment[],
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return typePropertyPathResolvesToUnknownWithState(
    type,
    path,
    environment,
    new Map(),
    new Set(),
    resolveImportedType,
  );
}

export function typePropertyPathResolvesToUnknownWithState(
  type: PortableTSType,
  path: readonly TypePropertyPathSegment[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return (
    typePropertyPathResolutionWithState(
      type,
      path,
      environment,
      substitutions,
      resolving,
      resolveImportedType,
    ) === "unknown"
  );
}

export function typePropertyPathResolutionWithState(
  type: PortableTSType,
  path: readonly TypePropertyPathSegment[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): TypePathResolution {
  return resolutionState(
    resolveTypePropertyKeyDomain(
      type,
      pathDomains(path, environment, substitutions, resolving, resolveImportedType),
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      new Map(),
      resolvePropertyKeyDomain,
    ),
  );
}

export function typePropertyKeyDomainResolvesToUnknownWithState(
  type: PortableTSType,
  keyDomain: PropertyKeyDomain,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolving: ReadonlySet<string>,
  resolveImportedType?: PortableTypeResolver,
): boolean {
  return (
    resolutionState(
      resolveTypePropertyKeyDomain(
        type,
        [keyDomain],
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        new Map(),
        resolvePropertyKeyDomain,
      ),
    ) === "unknown"
  );
}
