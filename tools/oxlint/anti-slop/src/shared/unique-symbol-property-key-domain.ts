import { emptyPropertyKeyDomain, type PropertyKeyDomain } from "./property-key-domain-model.ts";
import type {
  PortableTypeEnvironment,
  PortableTypeResolver,
  UniqueSymbolReference,
} from "./portable-type-resolution.ts";

export function resolveUniqueSymbolReferenceDomain(
  reference: UniqueSymbolReference,
  environment: PortableTypeEnvironment,
  resolveImportedType: PortableTypeResolver | undefined,
): PropertyKeyDomain {
  const identity = resolveImportedType?.resolveUniqueSymbol(reference, environment);
  return identity === null || identity === undefined
    ? emptyPropertyKeyDomain()
    : { ...emptyPropertyKeyDomain(), uniqueSymbols: new Set([identity]) };
}
