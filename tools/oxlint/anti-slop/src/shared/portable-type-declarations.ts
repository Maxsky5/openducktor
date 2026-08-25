import type {
  PortableClass,
  PortableModuleItem,
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSModuleDeclaration,
  PortableTSType,
  PortableTSTypeAliasDeclaration,
} from "./portable-ast.ts";
import {
  BUILT_INS,
  typeQueryUniqueSymbolReference,
  type PortableTypeEnvironment,
  type PortableValueBinding,
  type UniqueSymbolDeclaration,
  type UniqueSymbolReference,
} from "./portable-type-model.ts";
import { bindingPatternValueBindings } from "./portable-value-bindings.ts";

type PortableTypeEnvironmentLayer = {
  readonly environment: PortableTypeEnvironment;
  readonly uniqueSymbolAliasReferences: ReadonlyMap<string, UniqueSymbolReference>;
};

function declaration(statement: PortableModuleItem): PortableNode | null {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
}

function declarationName(node: PortableNode): string | null {
  if (node.type === "ImportDeclaration") return null;
  if (
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSEnumDeclaration" ||
    node.type === "ClassDeclaration"
  ) {
    return node.id?.name ?? null;
  }
  if (node.type === "TSImportEqualsDeclaration") return node.id.name;
  return null;
}

function unwrapUniqueSymbolType(type: PortableTSType): PortableTSType {
  return type.type === "TSParenthesizedType" ? unwrapUniqueSymbolType(type.typeAnnotation) : type;
}

function isExplicitUniqueSymbolType(type: PortableTSType): boolean {
  const unwrapped = unwrapUniqueSymbolType(type);
  return (
    unwrapped.type === "TSTypeOperator" &&
    unwrapped.operator === "unique" &&
    unwrapUniqueSymbolType(unwrapped.typeAnnotation).type === "TSSymbolKeyword"
  );
}

function inferredUniqueSymbolInitializer(initializer: PortableNode | null): boolean {
  return (
    initializer?.type === "CallExpression" &&
    initializer.callee.type === "Identifier" &&
    initializer.callee.name === "Symbol"
  );
}

function variableUniqueSymbolDeclaration(
  declarationKind: Extract<PortableNode, { type: "VariableDeclaration" }>["kind"],
  variable: Extract<PortableNode, { type: "VariableDeclarator" }>,
): UniqueSymbolDeclaration | null {
  if (variable.id.type !== "Identifier") return null;
  const annotation = variable.id.typeAnnotation?.typeAnnotation;
  if (annotation !== null && annotation !== undefined && isExplicitUniqueSymbolType(annotation)) {
    return { end: variable.id.end, kind: "explicit", start: variable.id.start };
  }
  return declarationKind === "const" && inferredUniqueSymbolInitializer(variable.init)
    ? { end: variable.id.end, kind: "symbol-call", start: variable.id.start }
    : null;
}

function variableUniqueSymbolAliasReference(
  variable: Extract<PortableNode, { type: "VariableDeclarator" }>,
): UniqueSymbolReference | null {
  if (variable.id.type !== "Identifier") return null;
  const annotation = variable.id.typeAnnotation?.typeAnnotation;
  const unwrapped =
    annotation === null || annotation === undefined ? null : unwrapUniqueSymbolType(annotation);
  return unwrapped?.type === "TSTypeQuery"
    ? typeQueryUniqueSymbolReference(unwrapped.exprName)
    : null;
}

function resolveUniqueSymbolAliasReferences(
  declarations: Map<string, UniqueSymbolDeclaration>,
  aliases: ReadonlyMap<string, UniqueSymbolReference>,
  importedTypeQueryNames: ReadonlySet<string>,
  namespaceValueNames: ReadonlySet<string>,
): void {
  const pending = new Map(aliases);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, reference] of pending) {
      const rootName = reference.kind === "name" ? reference.parts[0] : undefined;
      const local =
        reference.kind === "name" && reference.parts.length === 1 && rootName !== undefined
          ? declarations.get(rootName)
          : undefined;
      if (local !== undefined) {
        declarations.set(name, local);
      } else if (
        reference.kind === "import" ||
        (rootName !== undefined &&
          (importedTypeQueryNames.has(rootName) || namespaceValueNames.has(rootName)))
      ) {
        declarations.set(name, { kind: "reference", reference });
      } else {
        continue;
      }
      pending.delete(name);
      changed = true;
    }
  }
}

function createPortableModuleTypeEnvironmentLayer(
  statements: readonly PortableModuleItem[],
  visitorKeys: Readonly<Record<string, readonly string[]>> = {},
): PortableTypeEnvironmentLayer {
  const aliases = new Map<string, PortableTSTypeAliasDeclaration>();
  const classes = new Map<string, PortableClass[]>();
  const interfaces = new Map<string, PortableTSInterfaceDeclaration[]>();
  const namespaces = new Map<string, PortableTSModuleDeclaration[]>();
  const namespaceValueNames = new Set<string>();
  const typeNames = new Set<string>();
  const valueNames = new Set<string>();
  const importedTypeNames = new Set<string>();
  const importedTypeQueryNames = new Set<string>();
  const importedValueNames = new Set<string>();
  const competingInterfaceNames = new Set<string>();
  const uniqueSymbolDeclarations = new Map<string, UniqueSymbolDeclaration>();
  const uniqueSymbolAliasReferences = new Map<string, UniqueSymbolReference>();
  const valueBindings = new Map<string, PortableValueBinding>();

  for (const statement of statements) {
    const node = declaration(statement);
    if (node?.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        typeNames.add(specifier.local.name);
        importedTypeNames.add(specifier.local.name);
        importedTypeQueryNames.add(specifier.local.name);
        if (
          node.importKind !== "type" &&
          (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type")
        ) {
          valueNames.add(specifier.local.name);
          importedValueNames.add(specifier.local.name);
        }
        competingInterfaceNames.add(specifier.local.name);
      }
      continue;
    }
    if (node === null) continue;
    if (node.type === "VariableDeclaration") {
      for (const variable of node.declarations) {
        const visibleBindings =
          variable.id.type === "Identifier"
            ? [
                {
                  binding: {
                    declarationKind: node.kind,
                    declarator: variable,
                    kind: "variable" as const,
                  },
                  name: variable.id.name,
                },
              ]
            : bindingPatternValueBindings(
                variable.id,
                undefined,
                [],
                new Set(),
                variable.init ?? undefined,
              );
        for (const { binding, name } of visibleBindings) {
          valueNames.add(name);
          if (binding !== null) valueBindings.set(name, binding);
        }
        if (variable.id.type !== "Identifier") continue;
        const uniqueSymbol = variableUniqueSymbolDeclaration(node.kind, variable);
        if (uniqueSymbol !== null) {
          uniqueSymbolDeclarations.set(variable.id.name, uniqueSymbol);
        } else {
          const aliasReference = variableUniqueSymbolAliasReference(variable);
          if (aliasReference !== null) {
            uniqueSymbolAliasReferences.set(variable.id.name, aliasReference);
          }
        }
      }
    } else if (
      node.type === "ClassDeclaration" ||
      node.type === "FunctionDeclaration" ||
      node.type === "TSEnumDeclaration"
    ) {
      if (node.id !== null) valueNames.add(node.id.name);
    }
    if (
      node.type === "TSModuleDeclaration" &&
      node.global === false &&
      node.id.type === "Identifier"
    ) {
      valueNames.add(node.id.name);
      namespaceValueNames.add(node.id.name);
      const declarations = namespaces.get(node.id.name) ?? [];
      declarations.push(node);
      namespaces.set(node.id.name, declarations);
      continue;
    }
    const name = declarationName(node);
    if (name === null) continue;
    typeNames.add(name);
    if (node.type === "TSTypeAliasDeclaration") {
      aliases.set(name, node);
      competingInterfaceNames.add(name);
      continue;
    }
    if (node.type === "TSInterfaceDeclaration") {
      const declarations = interfaces.get(name) ?? [];
      declarations.push(node);
      interfaces.set(name, declarations);
      continue;
    }
    if (node.type === "ClassDeclaration") {
      const declarations = classes.get(name) ?? [];
      declarations.push(node);
      classes.set(name, declarations);
      continue;
    }
    competingInterfaceNames.add(name);
  }

  for (const name of competingInterfaceNames) interfaces.delete(name);
  if (valueNames.has("Symbol")) {
    for (const [name, symbolDeclaration] of uniqueSymbolDeclarations) {
      if (symbolDeclaration.kind === "symbol-call") uniqueSymbolDeclarations.delete(name);
    }
  }
  resolveUniqueSymbolAliasReferences(
    uniqueSymbolDeclarations,
    uniqueSymbolAliasReferences,
    importedTypeQueryNames,
    namespaceValueNames,
  );
  return {
    environment: {
      aliases,
      classes,
      declaredTypeNames: typeNames,
      declaredValueNames: valueNames,
      interfaces,
      importedTypeNames,
      importedTypeQueryNames,
      importedValueNames,
      namespaceValueNames,
      namespaces,
      shadowedBuiltIns: new Set([...typeNames].filter((name) => BUILT_INS.has(name))),
      uniqueSymbolDeclarations,
      valueBindings,
      visitorKeys,
    },
    uniqueSymbolAliasReferences,
  };
}

/** Build the declaration index used by portable type queries. */
export function createPortableModuleTypeEnvironment(
  statements: readonly PortableModuleItem[],
  visitorKeys: Readonly<Record<string, readonly string[]>> = {},
): PortableTypeEnvironment {
  return createPortableModuleTypeEnvironmentLayer(statements, visitorKeys).environment;
}

function shadowTypeName(
  name: string,
  environment: {
    aliases: Map<string, PortableTSTypeAliasDeclaration>;
    classes: Map<string, readonly PortableClass[]>;
    interfaces: Map<string, readonly PortableTSInterfaceDeclaration[]>;
    namespaces: Map<string, readonly PortableTSModuleDeclaration[]>;
    importedTypeNames: Set<string>;
    shadowedBuiltIns: Set<string>;
  },
): void {
  environment.aliases.delete(name);
  environment.classes.delete(name);
  environment.interfaces.delete(name);
  environment.namespaces.delete(name);
  environment.importedTypeNames.delete(name);
  if (BUILT_INS.has(name)) environment.shadowedBuiltIns.add(name);
}

export function extendPortableTypeEnvironment(
  environment: PortableTypeEnvironment,
  statements: readonly PortableModuleItem[],
): PortableTypeEnvironment {
  const aliases = new Map(environment.aliases);
  const classes = new Map(environment.classes);
  const declaredTypeNames = new Set(environment.declaredTypeNames);
  const declaredValueNames = new Set(environment.declaredValueNames);
  const importedTypeNames = new Set(environment.importedTypeNames);
  const importedTypeQueryNames = new Set(environment.importedTypeQueryNames);
  const importedValueNames = new Set(environment.importedValueNames);
  const interfaces = new Map(environment.interfaces);
  const namespaceValueNames = new Set(environment.namespaceValueNames);
  const namespaces = new Map(environment.namespaces);
  const shadowedBuiltIns = new Set(environment.shadowedBuiltIns);
  const uniqueSymbolDeclarations = new Map(environment.uniqueSymbolDeclarations);
  const valueBindings = new Map(environment.valueBindings);
  const layerResult = createPortableModuleTypeEnvironmentLayer(statements, environment.visitorKeys);
  const layer = layerResult.environment;
  for (const name of layer.declaredTypeNames) {
    shadowTypeName(name, {
      aliases,
      classes,
      importedTypeNames,
      interfaces,
      namespaces,
      shadowedBuiltIns,
    });
    declaredTypeNames.add(name);
  }
  for (const name of layer.importedTypeNames) importedTypeNames.add(name);
  for (const name of layer.declaredValueNames) {
    uniqueSymbolDeclarations.delete(name);
    valueBindings.delete(name);
    importedTypeQueryNames.delete(name);
    importedValueNames.delete(name);
    namespaceValueNames.delete(name);
    declaredValueNames.add(name);
  }
  for (const name of layer.importedTypeQueryNames) importedTypeQueryNames.add(name);
  for (const name of layer.importedValueNames) importedValueNames.add(name);
  for (const name of layer.namespaceValueNames) namespaceValueNames.add(name);
  for (const [name, symbolDeclaration] of layer.uniqueSymbolDeclarations) {
    if (symbolDeclaration.kind === "symbol-call" && environment.declaredValueNames.has("Symbol")) {
      continue;
    }
    uniqueSymbolDeclarations.set(name, symbolDeclaration);
  }
  resolveUniqueSymbolAliasReferences(
    uniqueSymbolDeclarations,
    layerResult.uniqueSymbolAliasReferences,
    importedTypeQueryNames,
    namespaceValueNames,
  );
  for (const [name, binding] of layer.valueBindings) valueBindings.set(name, binding);
  for (const [name, alias] of layer.aliases) aliases.set(name, alias);
  for (const [name, declarations] of layer.classes) classes.set(name, declarations);
  for (const [name, declarations] of layer.interfaces) interfaces.set(name, declarations);
  for (const [name, declarations] of layer.namespaces) namespaces.set(name, declarations);
  return {
    aliases,
    classes,
    declaredTypeNames,
    declaredValueNames,
    importedTypeNames,
    importedTypeQueryNames,
    importedValueNames,
    interfaces,
    namespaceValueNames,
    namespaces,
    shadowedBuiltIns,
    uniqueSymbolDeclarations,
    valueBindings,
    visitorKeys: environment.visitorKeys,
  };
}
