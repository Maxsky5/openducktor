import type { PortableNode } from "./portable-ast.ts";
import {
  emptyPropertyKeyDomain,
  propertyKeyDomainConcreteValues,
  propertyKeyDomainFromValue,
  propertyKeyDomainIsExact,
  unionPropertyKeyDomains,
  type PropertyKeyDomain,
} from "./property-key-domain-model.ts";
import {
  absentProperty,
  foundProperty,
  propertyKeyLookupOverlaps,
  unionPropertyKeyResolutions,
  type PropertyKeyDomainResolver,
  type QualifiedPropertyKeyResolution,
  type TypePropertyKeyDomainResolver,
} from "./qualified-property-key-model.ts";
import { numberPropertyKeyDomain, type TypePropertyDomainPath } from "./tuple-type-path.ts";
import {
  expressionTypeNameParts,
  resolveValueBindings,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type PortableValueBinding,
  type PortableValueProjectionSegment,
  type TypeSubstitutions,
  type UniqueSymbolReference,
} from "./portable-type-resolution.ts";
import { isConstAssertion } from "./type-assertion.ts";
import { resolveUniqueSymbolReferenceDomain } from "./unique-symbol-property-key-domain.ts";

type VariableBinding = Extract<PortableValueBinding, { kind: "variable" }>;
type ValueInitializer = NonNullable<VariableBinding["declarator"]["init"]>;

function broadPrimitivePropertyKeyDomain(kind: "number" | "string" | "symbol"): PropertyKeyDomain {
  return {
    ...emptyPropertyKeyDomain(),
    numbers: kind === "number",
    strings: kind === "string",
    symbols: kind === "symbol",
  };
}

function projectionPath(path: readonly PortableValueProjectionSegment[]): TypePropertyDomainPath {
  return path.map((segment) =>
    typeof segment === "object" ? segment : propertyKeyDomainFromValue(segment),
  );
}

function domainPathRootString(path: TypePropertyDomainPath): string | undefined {
  const root = path[0];
  if (root === undefined || "kind" in root) return undefined;
  const values = propertyKeyDomainConcreteValues(root);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
}

function valueBindingPropertyKeyResolution(
  binding: PortableValueBinding,
  propertyPath: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): QualifiedPropertyKeyResolution {
  if (binding.kind === "typed") {
    const combinedPath = [...projectionPath(binding.propertyPath), ...propertyPath];
    const selectedRoot = domainPathRootString(combinedPath);
    if (selectedRoot !== undefined && binding.omittedProperties.has(selectedRoot)) {
      return absentProperty();
    }
    const resolution = resolveTypePath(
      binding.type,
      combinedPath,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
    );
    return resolution;
  }
  if (binding.kind === "projected") {
    const combinedPath = [...projectionPath(binding.propertyPath), ...propertyPath];
    const selectedRoot = domainPathRootString(combinedPath);
    if (selectedRoot !== undefined && binding.omittedProperties.has(selectedRoot)) {
      return absentProperty();
    }
    return inferredQualifiedExpressionPropertyKeyResolution(
      binding.expression,
      combinedPath,
      false,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
  }
  const annotation =
    binding.declarator.id.type === "Identifier"
      ? binding.declarator.id.typeAnnotation?.typeAnnotation
      : undefined;
  if (annotation !== undefined && annotation !== null) {
    const resolution = resolveTypePath(
      annotation,
      propertyPath,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
    );
    return resolution;
  }
  const initializer = binding.declarator.init;
  if (initializer === null) return absentProperty();
  return propertyPath.length === 0
    ? foundProperty(
        inferredExpressionPropertyKeyDomain(
          initializer,
          binding.declarationKind,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolvingVariableNames,
          resolveDomain,
          resolveTypePath,
        ),
      )
    : inferredQualifiedExpressionPropertyKeyResolution(
        initializer,
        propertyPath,
        false,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      );
}

function exactPropertyPathParts(path: TypePropertyDomainPath): readonly string[] | null {
  const parts: string[] = [];
  for (const segment of path) {
    if ("kind" in segment) return null;
    const values = propertyKeyDomainConcreteValues(segment);
    if (values.length !== 1) return null;
    parts.push(String(values[0]));
  }
  return parts;
}

function appendReferencePath(
  reference: UniqueSymbolReference,
  propertyPath: TypePropertyDomainPath,
): UniqueSymbolReference | null {
  const pathParts = exactPropertyPathParts(propertyPath);
  if (pathParts === null) return null;
  return reference.kind === "import"
    ? { ...reference, exportPath: [...reference.exportPath, ...pathParts] }
    : { ...reference, parts: [...reference.parts, ...pathParts] };
}

/** Resolve local, namespaced, and imported values through one shared path. */
export function namedValuePropertyKeyResolutions(
  reference: UniqueSymbolReference,
  propertyPath: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): readonly QualifiedPropertyKeyResolution[] {
  const parts = reference.kind === "name" ? reference.parts : [];
  const rootName = parts[0];
  if (rootName !== undefined && resolvingVariableNames.has(rootName)) return [];
  const nextVariableNames =
    rootName === undefined
      ? resolvingVariableNames
      : new Set([...resolvingVariableNames, rootName]);
  const directBinding =
    rootName === undefined ? undefined : environment.valueBindings.get(rootName);
  const direct =
    directBinding === undefined || rootName === undefined
      ? []
      : [
          valueBindingPropertyKeyResolution(
            directBinding,
            [...parts.slice(1).map(propertyKeyDomainFromValue), ...propertyPath],
            environment,
            substitutions,
            resolveImportedType,
            resolving,
            keyDomainSubstitutions,
            nextVariableNames,
            resolveDomain,
            resolveTypePath,
          ),
        ];
  const namespace =
    parts.length <= 1
      ? []
      : resolveValueBindings(parts, environment).map(
          ({ binding, environment: bindingEnvironment }) =>
            valueBindingPropertyKeyResolution(
              binding,
              propertyPath,
              bindingEnvironment,
              substitutions,
              resolveImportedType,
              resolving,
              keyDomainSubstitutions,
              nextVariableNames,
              resolveDomain,
              resolveTypePath,
            ),
        );
  const resolvedReference = appendReferencePath(reference, propertyPath);
  const uniqueSymbolDomain =
    resolvedReference === null
      ? emptyPropertyKeyDomain()
      : resolveUniqueSymbolReferenceDomain(resolvedReference, environment, resolveImportedType);
  const uniqueSymbol =
    uniqueSymbolDomain.uniqueSymbols.size === 0 ? [] : [foundProperty(uniqueSymbolDomain)];
  const imported =
    resolvedReference === null
      ? null
      : resolveImportedType?.resolveValue(resolvedReference, environment);
  const importedDomains =
    imported === null || imported === undefined
      ? []
      : [
          valueBindingPropertyKeyResolution(
            imported.binding,
            projectionPath(imported.propertyPath),
            imported.environment,
            new Map(),
            imported.resolveImportedType,
            resolving,
            keyDomainSubstitutions,
            nextVariableNames,
            resolveDomain,
            resolveTypePath,
          ),
        ];
  return [...uniqueSymbol, ...direct, ...namespace, ...importedDomains].filter(
    (resolution) => resolution.found,
  );
}

export function namedValuePropertyKeyDomain(
  reference: UniqueSymbolReference,
  propertyPath: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): PropertyKeyDomain {
  const resolutions = namedValuePropertyKeyResolutions(
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
  );
  return unionPropertyKeyDomains(
    resolutions.flatMap((resolution) => (resolution.found ? [resolution.value] : [])),
  );
}

function expressionBindingPropertyKeyResolutions(
  expression: PortableNode,
  propertyPath: TypePropertyDomainPath,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): readonly QualifiedPropertyKeyResolution[] {
  const parts = expressionTypeNameParts(expression);
  return parts.length === 0
    ? []
    : namedValuePropertyKeyResolutions(
        { kind: "name", parts },
        propertyPath,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      );
}

type ObjectProperty = Extract<
  Extract<ValueInitializer, { type: "ObjectExpression" }>["properties"][number],
  { type: "Property" }
>;

function objectPropertyKeyDomain(
  property: ObjectProperty,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): PropertyKeyDomain {
  if (!property.computed && property.key.type === "Identifier") {
    return propertyKeyDomainFromValue(property.key.name);
  }
  if (
    property.key.type === "Literal" &&
    (typeof property.key.value === "string" || typeof property.key.value === "number")
  ) {
    return propertyKeyDomainFromValue(property.key.value);
  }
  if (!property.computed) return emptyPropertyKeyDomain();
  const resolutions = expressionBindingPropertyKeyResolutions(
    property.key,
    [],
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
    resolvingVariableNames,
    resolveDomain,
    resolveTypePath,
  );
  if (resolutions.length > 0) {
    return unionPropertyKeyDomains(
      resolutions.flatMap((resolution) => (resolution.found ? [resolution.value] : [])),
    );
  }
  return property.key.type === "TemplateLiteral" || property.key.type === "UnaryExpression"
    ? inferredExpressionPropertyKeyDomain(
        property.key,
        "const",
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      )
    : emptyPropertyKeyDomain();
}

function inferredExpressionPropertyKeyDomain(
  expression: ValueInitializer,
  declarationKind: VariableBinding["declarationKind"],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): PropertyKeyDomain {
  if (expression.type === "Literal") {
    const value = expression.value;
    if (typeof value === "string" || typeof value === "number") {
      return declarationKind === "const"
        ? propertyKeyDomainFromValue(value)
        : broadPrimitivePropertyKeyDomain(typeof value === "string" ? "string" : "number");
    }
    return emptyPropertyKeyDomain();
  }
  if (
    expression.type === "UnaryExpression" &&
    (expression.operator === "+" || expression.operator === "-") &&
    expression.argument.type === "Literal" &&
    typeof expression.argument.value === "number"
  ) {
    const value =
      expression.operator === "-" ? -expression.argument.value : expression.argument.value;
    return declarationKind === "const"
      ? propertyKeyDomainFromValue(value)
      : broadPrimitivePropertyKeyDomain("number");
  }
  if (expression.type === "TemplateLiteral") {
    if (expression.expressions.length > 0) return broadPrimitivePropertyKeyDomain("string");
    const value = expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw;
    return value === undefined
      ? emptyPropertyKeyDomain()
      : declarationKind === "const"
        ? propertyKeyDomainFromValue(value)
        : broadPrimitivePropertyKeyDomain("string");
  }
  if (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion") {
    if (isConstAssertion(expression)) {
      return inferredExpressionPropertyKeyDomain(
        expression.expression,
        "const",
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      );
    }
    return resolveDomain(
      expression.typeAnnotation,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
  }
  if (expression.type === "TSSatisfiesExpression") {
    return inferredExpressionPropertyKeyDomain(
      expression.expression,
      declarationKind,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
  }
  if (expression.type === "ConditionalExpression") {
    return unionPropertyKeyDomains(
      [expression.consequent, expression.alternate].map((branch) =>
        inferredExpressionPropertyKeyDomain(
          branch,
          declarationKind,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolvingVariableNames,
          resolveDomain,
          resolveTypePath,
        ),
      ),
    );
  }
  if (
    expression.type === "CallExpression" &&
    expression.callee.type === "Identifier" &&
    expression.callee.name === "Symbol" &&
    !environment.declaredValueNames.has("Symbol")
  ) {
    return broadPrimitivePropertyKeyDomain("symbol");
  }
  const bindingResolutions = expressionBindingPropertyKeyResolutions(
    expression,
    [],
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
    resolvingVariableNames,
    resolveDomain,
    resolveTypePath,
  );
  const bindingDomains = bindingResolutions.flatMap((resolution) =>
    resolution.found ? [resolution.value] : [],
  );
  return bindingDomains.length === 0
    ? emptyPropertyKeyDomain()
    : unionPropertyKeyDomains(bindingDomains);
}

function selectedArrayIndices(
  segment: PropertyKeyDomain,
  length: number,
  offset: number,
): readonly number[] {
  if (segment.numbers) {
    return Array.from({ length: Math.max(0, length - offset) }, (_, index) => offset + index);
  }
  return propertyKeyDomainConcreteValues(segment).flatMap((value): readonly number[] => {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && String(index) === String(value)
      ? [offset + index]
      : [];
  });
}

function inferredArrayExpressionPropertyKeyResolution(
  expression: Extract<ValueInitializer, { type: "ArrayExpression" }>,
  propertyPath: TypePropertyDomainPath,
  preserveLiterals: boolean,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): QualifiedPropertyKeyResolution {
  const [head, ...tail] = propertyPath;
  const offset = head !== undefined && "kind" in head ? head.offset : 0;
  const segment = head !== undefined && "kind" in head ? tail[0] : head;
  const rest = head !== undefined && "kind" in head ? tail.slice(1) : tail;
  if (segment === undefined || "kind" in segment) return absentProperty();
  if (!propertyKeyLookupOverlaps(segment, numberPropertyKeyDomain)) return absentProperty();
  const indices = selectedArrayIndices(segment, expression.elements.length, offset);
  return unionPropertyKeyResolutions(
    indices.flatMap((index): readonly QualifiedPropertyKeyResolution[] => {
      const element = expression.elements[index];
      if (element === null || element === undefined) return [];
      if (element.type === "SpreadElement") {
        return [
          inferredQualifiedExpressionPropertyKeyResolution(
            element.argument,
            [numberPropertyKeyDomain, ...rest],
            preserveLiterals,
            environment,
            substitutions,
            resolveImportedType,
            resolving,
            keyDomainSubstitutions,
            resolvingVariableNames,
            resolveDomain,
            resolveTypePath,
          ),
        ];
      }
      return [
        inferredQualifiedExpressionPropertyKeyResolution(
          element,
          rest,
          preserveLiterals,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
          resolvingVariableNames,
          resolveDomain,
          resolveTypePath,
        ),
      ];
    }),
  );
}

function inferredQualifiedExpressionPropertyKeyResolution(
  expression: ValueInitializer,
  propertyPath: TypePropertyDomainPath,
  preserveLiterals: boolean,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolvingVariableNames: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  resolveTypePath: TypePropertyKeyDomainResolver,
): QualifiedPropertyKeyResolution {
  if (propertyPath.length === 0) {
    return foundProperty(
      inferredExpressionPropertyKeyDomain(
        expression,
        preserveLiterals ? "const" : "let",
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      ),
    );
  }
  if (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion") {
    if (isConstAssertion(expression)) {
      return inferredQualifiedExpressionPropertyKeyResolution(
        expression.expression,
        propertyPath,
        true,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      );
    }
    const resolution = resolveTypePath(
      expression.typeAnnotation,
      propertyPath,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
    );
    return resolution;
  }
  if (expression.type === "TSSatisfiesExpression") {
    return inferredQualifiedExpressionPropertyKeyResolution(
      expression.expression,
      propertyPath,
      preserveLiterals,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
  }
  if (expression.type === "ConditionalExpression") {
    const resolutions = [expression.consequent, expression.alternate].map((branch) =>
      inferredQualifiedExpressionPropertyKeyResolution(
        branch,
        propertyPath,
        preserveLiterals,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      ),
    );
    const found = resolutions.filter((resolution) => resolution.found);
    return found.length === 0
      ? absentProperty()
      : foundProperty(
          unionPropertyKeyDomains(found.map((resolution) => resolution.value)),
          resolutions.every((resolution) => resolution.found && resolution.definite),
        );
  }
  if (expression.type === "ArrayExpression") {
    return inferredArrayExpressionPropertyKeyResolution(
      expression,
      propertyPath,
      preserveLiterals,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
  }
  const bindingResolutions = expressionBindingPropertyKeyResolutions(
    expression,
    propertyPath,
    environment,
    substitutions,
    resolveImportedType,
    resolving,
    keyDomainSubstitutions,
    resolvingVariableNames,
    resolveDomain,
    resolveTypePath,
  );
  const foundBindings = bindingResolutions.filter((resolution) => resolution.found);
  if (foundBindings.length > 0) {
    return foundProperty(
      unionPropertyKeyDomains(foundBindings.map((resolution) => resolution.value)),
      foundBindings.some((resolution) => resolution.definite),
    );
  }
  if (expression.type !== "ObjectExpression") return absentProperty();
  const [requestedKey, ...rest] = propertyPath;
  if (requestedKey === undefined || "kind" in requestedKey) return absentProperty();
  const possibleDomains: PropertyKeyDomain[] = [];
  for (const property of [...expression.properties].reverse()) {
    if (property.type === "SpreadElement") {
      const spreadResolution = inferredQualifiedExpressionPropertyKeyResolution(
        property.argument,
        propertyPath,
        preserveLiterals,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolvingVariableNames,
        resolveDomain,
        resolveTypePath,
      );
      if (!spreadResolution.found) continue;
      if (spreadResolution.definite) {
        return foundProperty(unionPropertyKeyDomains([...possibleDomains, spreadResolution.value]));
      }
      possibleDomains.push(spreadResolution.value);
      continue;
    }
    const keyDomain = objectPropertyKeyDomain(
      property,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
    if (!propertyKeyLookupOverlaps(requestedKey, keyDomain)) continue;
    const valueResolution = inferredQualifiedExpressionPropertyKeyResolution(
      property.value,
      rest,
      preserveLiterals,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvingVariableNames,
      resolveDomain,
      resolveTypePath,
    );
    if (!valueResolution.found) continue;
    const definiteKey =
      propertyKeyDomainIsExact(keyDomain) && propertyKeyDomainIsExact(requestedKey);
    if (definiteKey) {
      return foundProperty(unionPropertyKeyDomains([...possibleDomains, valueResolution.value]));
    }
    possibleDomains.push(valueResolution.value);
  }
  return possibleDomains.length === 0
    ? absentProperty()
    : foundProperty(unionPropertyKeyDomains(possibleDomains), false);
}
