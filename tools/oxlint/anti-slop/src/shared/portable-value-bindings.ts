import type { ESTree } from "@oxlint/plugins";

import type { PortableNode, PortableTSType } from "./portable-ast.ts";
import {
  BUILT_INS,
  type PortableTypeEnvironment,
  type PortableValueBinding,
  type PortableValueProjectionSegment,
} from "./portable-type-model.ts";

export type VisibleValueBinding = {
  readonly binding: PortableValueBinding | null;
  readonly name: string;
};

type PortableValueExpression = NonNullable<
  Extract<PortableNode, { type: "VariableDeclarator" }>["init"]
>;

function bindingPatternType(pattern: PortableNode | ESTree.Node): PortableTSType | undefined {
  if (
    pattern.type !== "Identifier" &&
    pattern.type !== "ArrayPattern" &&
    pattern.type !== "ObjectPattern" &&
    pattern.type !== "RestElement"
  ) {
    return undefined;
  }
  return pattern.typeAnnotation?.typeAnnotation;
}

function objectPatternPropertyKey(property: {
  readonly computed: boolean;
  readonly key: PortableNode | ESTree.Node;
}): number | string | null {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (
    property.key.type === "Literal" &&
    (typeof property.key.value === "string" || typeof property.key.value === "number")
  ) {
    return property.key.value;
  }
  return null;
}

export function bindingPatternValueBindings(
  pattern: PortableNode | ESTree.Node,
  sourceType: PortableTSType | undefined = bindingPatternType(pattern),
  propertyPath: readonly PortableValueProjectionSegment[] = [],
  omittedProperties: ReadonlySet<string> = new Set(),
  sourceExpression?: PortableValueExpression,
): readonly VisibleValueBinding[] {
  if (pattern.type === "Identifier") {
    const type = pattern.typeAnnotation?.typeAnnotation;
    const bindingType = type ?? sourceType;
    return [
      {
        binding:
          bindingType !== undefined
            ? { kind: "typed", omittedProperties, propertyPath, type: bindingType }
            : sourceExpression === undefined
              ? null
              : {
                  expression: sourceExpression,
                  kind: "projected",
                  omittedProperties,
                  propertyPath,
                },
        name: pattern.name,
      },
    ];
  }
  if (pattern.type === "AssignmentPattern") {
    return bindingPatternValueBindings(
      pattern.left,
      sourceType,
      propertyPath,
      omittedProperties,
      sourceExpression,
    );
  }
  if (pattern.type === "RestElement") {
    return bindingPatternValueBindings(
      pattern.argument,
      sourceType,
      propertyPath,
      omittedProperties,
      sourceExpression,
    );
  }
  if (pattern.type === "ArrayPattern") {
    const patternType = bindingPatternType(pattern) ?? sourceType;
    return pattern.elements.flatMap((element, index) =>
      element === null
        ? []
        : bindingPatternValueBindings(
            element,
            patternType,
            [
              ...propertyPath,
              element.type === "RestElement" ? { kind: "array-rest", offset: index } : index,
            ],
            omittedProperties,
            sourceExpression,
          ),
    );
  }
  if (pattern.type === "ObjectPattern") {
    const patternType = bindingPatternType(pattern) ?? sourceType;
    const omitted = new Set(
      pattern.properties.flatMap((property): readonly string[] => {
        if (property.type === "RestElement") return [];
        const key = objectPatternPropertyKey(property);
        return typeof key === "string" ? [key] : [];
      }),
    );
    return pattern.properties.flatMap((property) => {
      if (property.type === "RestElement") {
        return bindingPatternValueBindings(
          property.argument,
          patternType,
          propertyPath,
          new Set([...omittedProperties, ...omitted]),
          sourceExpression,
        );
      }
      const key = objectPatternPropertyKey(property);
      return key === null
        ? []
        : bindingPatternValueBindings(
            property.value,
            patternType,
            [...propertyPath, key],
            omittedProperties,
            sourceExpression,
          );
    });
  }
  return [];
}

export function withVisibleValueBindings(
  environment: PortableTypeEnvironment,
  bindings: readonly VisibleValueBinding[],
): PortableTypeEnvironment {
  if (bindings.length === 0) return environment;
  const declaredValueNames = new Set(environment.declaredValueNames);
  const importedValueNames = new Set(environment.importedValueNames);
  const importedTypeQueryNames = new Set(environment.importedTypeQueryNames);
  const namespaceValueNames = new Set(environment.namespaceValueNames);
  const uniqueSymbolDeclarations = new Map(environment.uniqueSymbolDeclarations);
  const valueBindings = new Map(environment.valueBindings);
  for (const { binding, name } of bindings) {
    declaredValueNames.add(name);
    importedTypeQueryNames.delete(name);
    importedValueNames.delete(name);
    namespaceValueNames.delete(name);
    uniqueSymbolDeclarations.delete(name);
    valueBindings.delete(name);
    if (binding !== null) valueBindings.set(name, binding);
  }
  return {
    ...environment,
    declaredValueNames,
    importedTypeQueryNames,
    importedValueNames,
    namespaceValueNames,
    uniqueSymbolDeclarations,
    valueBindings,
  };
}

export function emptyTypeEnvironment(
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): PortableTypeEnvironment {
  return {
    aliases: new Map(),
    classes: new Map(),
    declaredTypeNames: new Set(),
    declaredValueNames: new Set(),
    importedTypeNames: new Set(),
    importedTypeQueryNames: new Set(),
    importedValueNames: new Set(),
    interfaces: new Map(),
    namespaceValueNames: new Set(),
    namespaces: new Map(),
    shadowedBuiltIns: new Set(),
    uniqueSymbolDeclarations: new Map(),
    valueBindings: new Map(),
    visitorKeys,
  };
}

export function withoutVisibleTypeName(
  environment: PortableTypeEnvironment,
  name: string,
): PortableTypeEnvironment {
  const aliases = new Map(environment.aliases);
  const classes = new Map(environment.classes);
  const interfaces = new Map(environment.interfaces);
  const namespaces = new Map(environment.namespaces);
  const importedTypeNames = new Set(environment.importedTypeNames);
  const shadowedBuiltIns = new Set(environment.shadowedBuiltIns);
  aliases.delete(name);
  classes.delete(name);
  interfaces.delete(name);
  namespaces.delete(name);
  importedTypeNames.delete(name);
  if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
  return {
    aliases,
    classes,
    declaredTypeNames: new Set([...environment.declaredTypeNames, name]),
    declaredValueNames: environment.declaredValueNames,
    importedTypeNames,
    importedTypeQueryNames: environment.importedTypeQueryNames,
    importedValueNames: environment.importedValueNames,
    interfaces,
    namespaceValueNames: environment.namespaceValueNames,
    namespaces,
    shadowedBuiltIns,
    uniqueSymbolDeclarations: environment.uniqueSymbolDeclarations,
    valueBindings: environment.valueBindings,
    visitorKeys: environment.visitorKeys,
  };
}
