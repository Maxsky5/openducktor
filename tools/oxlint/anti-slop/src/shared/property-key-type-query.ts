import type { PortableTSType } from "./portable-ast.ts";
import { emptyPropertyKeyDomain, type PropertyKeyDomain } from "./property-key-domain-model.ts";
import { namedValuePropertyKeyResolutions } from "./property-key-value-binding.ts";
import {
  unionPropertyKeyResolutions,
  type PropertyKeyDomainResolver,
  type QualifiedPropertyKeyResolution,
  type TypePropertyKeyDomainResolver,
} from "./qualified-property-key-model.ts";
import {
  typeQueryUniqueSymbolReference,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";
import type { TypePropertyDomainPath } from "./tuple-type-path.ts";

export function resolveTypeQueryPropertyKeyPath(
  type: Extract<PortableTSType, { type: "TSTypeQuery" }>,
  propertyPath: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): QualifiedPropertyKeyResolution {
  const reference = typeQueryUniqueSymbolReference(type.exprName);
  return unionPropertyKeyResolutions(
    namedValuePropertyKeyResolutions(
      reference,
      propertyPath,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      new Set(),
      resolveDomain,
      resolveTypePath,
    ),
  );
}

export function resolveTypeQueryPropertyKeyDomain(
  type: Extract<PortableTSType, { type: "TSTypeQuery" }>,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): PropertyKeyDomain {
  const resolution = resolveTypeQueryPropertyKeyPath(
    type,
    [],
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
    resolveDomain,
    resolveTypePath,
  );
  return resolution.found ? resolution.value : emptyPropertyKeyDomain();
}
