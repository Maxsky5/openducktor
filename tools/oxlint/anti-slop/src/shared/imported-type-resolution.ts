import { readFileSync } from "node:fs";
import path from "node:path";
import type { ESTree } from "@oxlint/plugins";
import { parseSync } from "oxc-parser";
import ts from "typescript";

import {
  createPortableModuleTypeEnvironment,
  extendPortableTypeEnvironment,
  type ResolvedPortableValueBinding,
  type ResolvedPortableType,
  type PortableTypeArgument,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type UniqueSymbolDeclaration,
  type UniqueSymbolReference,
} from "./portable-type-resolution.ts";

import type { PortableModuleItem, PortableNode } from "./portable-ast.ts";

type ParsedModule = {
  readonly environment: PortableTypeEnvironment;
  readonly statements: readonly PortableModuleItem[];
};

type ExportTarget = {
  readonly filename: string;
  readonly key: string;
  readonly localName: string;
  readonly module: ParsedModule;
};

type ImportedBinding =
  | {
      readonly kind: "direct";
      readonly exportedName: string;
      readonly moduleSpecifier: string;
    }
  | { readonly kind: "namespace"; readonly moduleSpecifier: string };

type ImportedReference = {
  readonly exportPath: readonly string[];
  readonly moduleSpecifier: string;
};

const moduleCache = new Map<string, ParsedModule>();
const optionsCache = new Map<string, ts.CompilerOptions>();

function compilerOptions(filename: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists);
  if (configPath === undefined) return {};
  const cached = optionsCache.get(configPath);
  if (cached !== undefined) return cached;
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const options = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  ).options;
  optionsCache.set(configPath, options);
  return options;
}

function resolveModule(filename: string, moduleSpecifier: string): string | null {
  const resolved = ts.resolveModuleName(
    moduleSpecifier,
    filename,
    compilerOptions(filename),
    ts.sys,
  ).resolvedModule;
  return resolved === undefined ? null : path.resolve(resolved.resolvedFileName);
}

function parsedModule(filename: string): ParsedModule {
  const cached = moduleCache.get(filename);
  if (cached !== undefined) return cached;
  const result = parseSync(filename, readFileSync(filename, "utf8"));
  const parseError = result.errors.find((error) => error.severity === "Error");
  if (parseError !== undefined) {
    throw new Error(`Cannot inspect imported type in ${filename}: ${parseError.message}`);
  }
  const statements = result.program.body;
  const parsed = {
    environment: createPortableModuleTypeEnvironment(statements),
    statements,
  };
  moduleCache.set(filename, parsed);
  return parsed;
}

function declarationName(declaration: PortableNode | null): string | null {
  if (
    declaration?.type === "TSTypeAliasDeclaration" ||
    declaration?.type === "TSInterfaceDeclaration"
  ) {
    return declaration.id.name;
  }
  if (declaration?.type === "TSModuleDeclaration" && declaration.id.type === "Identifier") {
    return declaration.id.name;
  }
  return null;
}

function importedBinding(module: ParsedModule, localName: string): ImportedBinding | null {
  for (const statement of module.statements) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== localName) continue;
      if (specifier.type === "ImportDefaultSpecifier") {
        return {
          kind: "direct",
          exportedName: "default",
          moduleSpecifier: statement.source.value,
        };
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        return { kind: "namespace", moduleSpecifier: statement.source.value };
      }
      return {
        kind: "direct",
        exportedName:
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value,
        moduleSpecifier: statement.source.value,
      };
    }
  }
  return null;
}

function importedReference(
  module: ParsedModule,
  parts: readonly string[],
): ImportedReference | null {
  const localName = parts[0];
  if (localName === undefined) return null;
  const binding = importedBinding(module, localName);
  if (binding === null) return null;
  if (binding.kind === "direct") {
    return {
      exportPath: [binding.exportedName, ...parts.slice(1)],
      moduleSpecifier: binding.moduleSpecifier,
    };
  }
  const exportPath = parts.slice(1);
  return exportPath.length === 0 ? null : { exportPath, moduleSpecifier: binding.moduleSpecifier };
}

function importedTypeResolver(
  containingFile: string,
  module: ParsedModule,
  resolving: ReadonlySet<string>,
): PortableTypeResolver {
  return {
    resolveType(typeNameParts, arguments_) {
      const imported = importedReference(module, typeNameParts);
      return imported === null
        ? null
        : importedTypeDefinition(
            containingFile,
            imported.moduleSpecifier,
            imported.exportPath,
            arguments_,
            resolving,
          );
    },
    resolveValue(reference, environment) {
      if (reference.kind === "name") {
        const rootName = reference.parts[0];
        if (rootName === undefined) return null;
        if (
          !environment.importedTypeQueryNames.has(rootName) &&
          !environment.namespaceValueNames.has(rootName)
        ) {
          return null;
        }
      }
      const imported =
        reference.kind === "import"
          ? {
              exportPath: reference.exportPath,
              moduleSpecifier: reference.moduleSpecifier,
            }
          : importedReference(module, reference.parts);
      return imported === null
        ? null
        : importedValueBinding(
            containingFile,
            imported.moduleSpecifier,
            imported.exportPath,
            resolving,
          );
    },
    resolveUniqueSymbol(reference, environment) {
      if (reference.kind === "name") {
        const name = reference.parts[0];
        const declaration =
          reference.parts.length === 1 && name !== undefined
            ? environment.uniqueSymbolDeclarations.get(name)
            : undefined;
        if (declaration !== undefined) {
          return uniqueSymbolDeclarationIdentity(containingFile, module, declaration, new Set());
        }
        if (name === undefined) return null;
        if (reference.parts.length === 1 && !environment.importedTypeQueryNames.has(name)) {
          return null;
        }
        if (
          reference.parts.length > 1 &&
          !environment.importedTypeQueryNames.has(name) &&
          !environment.namespaceValueNames.has(name)
        ) {
          return null;
        }
      }
      const target = uniqueSymbolReferenceTarget(containingFile, module, reference, new Set());
      return target === null ? null : uniqueSymbolIdentity(target);
    },
  };
}

function localValueBinding(
  target: ExportTarget,
  propertyPath: readonly string[],
): ResolvedPortableValueBinding | null {
  const binding = target.module.environment.valueBindings.get(target.localName);
  return binding === undefined
    ? null
    : {
        binding,
        environment: target.module.environment,
        propertyPath,
        resolveImportedType: importedTypeResolver(target.filename, target.module, new Set()),
      };
}

function importedValueBinding(
  containingFile: string,
  moduleSpecifier: string,
  exportPath: readonly string[],
  resolving: ReadonlySet<string>,
): ResolvedPortableValueBinding | null {
  for (let exportedLength = exportPath.length; exportedLength > 0; exportedLength -= 1) {
    const target = importedExportTarget(
      containingFile,
      moduleSpecifier,
      exportPath.slice(0, exportedLength),
      resolving,
    );
    if (target === null) continue;
    const binding = localValueBinding(target, exportPath.slice(exportedLength));
    if (binding !== null) return binding;
  }
  return null;
}

function localTypeDefinition(
  filename: string,
  module: ParsedModule,
  localName: string,
  arguments_: readonly PortableTypeArgument[],
  key: string,
): ResolvedPortableType | null {
  const resolveImportedType = importedTypeResolver(filename, module, new Set());
  const alias = module.environment.aliases.get(localName);
  if (alias !== undefined) {
    return {
      arguments: arguments_,
      declaration: alias,
      environment: module.environment,
      key,
      kind: "alias",
      resolveImportedType,
    };
  }
  const declarations = module.environment.interfaces.get(localName);
  if (declarations !== undefined) {
    return {
      arguments: arguments_,
      declarations,
      environment: module.environment,
      key,
      kind: "interface",
      name: localName,
      resolveImportedType,
    };
  }
  return null;
}

function namespaceModule(module: ParsedModule, namespaceName: string): ParsedModule | null {
  const statements = module.statements.flatMap((statement) => {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    return declaration?.type === "TSModuleDeclaration" &&
      declaration.id.type === "Identifier" &&
      declaration.id.name === namespaceName &&
      declaration.body?.type === "TSModuleBlock"
      ? declaration.body.body
      : [];
  });
  return statements.length === 0
    ? null
    : { environment: extendPortableTypeEnvironment(module.environment, statements), statements };
}

function uniqueSymbolIdentity(target: ExportTarget): string | null {
  return uniqueSymbolTargetIdentity(target, new Set());
}

function uniqueSymbolReferenceTarget(
  containingFile: string,
  module: ParsedModule,
  reference: UniqueSymbolReference,
  resolving: ReadonlySet<string>,
): ExportTarget | null {
  return reference.kind === "import"
    ? importedExportTarget(
        containingFile,
        reference.moduleSpecifier,
        reference.exportPath,
        resolving,
      )
    : localExportTarget(
        containingFile,
        module,
        reference.parts,
        resolving,
        [containingFile, ...reference.parts].join("\0"),
      );
}

function uniqueSymbolDeclarationIdentity(
  filename: string,
  module: ParsedModule,
  declaration: UniqueSymbolDeclaration,
  resolving: ReadonlySet<string>,
): string | null {
  if (declaration.kind !== "reference") {
    return [filename, String(declaration.start), String(declaration.end)].join("\0");
  }
  const target = uniqueSymbolReferenceTarget(filename, module, declaration.reference, resolving);
  return target === null ? null : uniqueSymbolTargetIdentity(target, resolving);
}

function uniqueSymbolTargetIdentity(
  target: ExportTarget,
  resolving: ReadonlySet<string>,
): string | null {
  if (resolving.has(target.key)) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(target.key);
  const declaration = target.module.environment.uniqueSymbolDeclarations.get(target.localName);
  return declaration === undefined
    ? null
    : uniqueSymbolDeclarationIdentity(target.filename, target.module, declaration, nextResolving);
}

function declarationDeclaresName(declaration: PortableNode | null, name: string): boolean {
  if (declaration?.type === "VariableDeclaration") {
    return declaration.declarations.some(
      (variable) => variable.id.type === "Identifier" && variable.id.name === name,
    );
  }
  return declarationName(declaration) === name;
}

function localExportTarget(
  filename: string,
  module: ParsedModule,
  localPath: readonly string[],
  resolving: ReadonlySet<string>,
  key: string,
): ExportTarget | null {
  const imported = importedReference(module, localPath);
  if (imported !== null) {
    return importedExportTarget(filename, imported.moduleSpecifier, imported.exportPath, resolving);
  }
  const [localName, ...rest] = localPath;
  if (localName === undefined) return null;
  if (rest.length === 0) return { filename, key, localName, module };
  const nested = namespaceModule(module, localName);
  return nested === null ? null : exportedExportTarget(filename, nested, rest, resolving, key);
}

function exportedExportTarget(
  filename: string,
  module: ParsedModule,
  exportPath: readonly string[],
  resolving: ReadonlySet<string>,
  key: string,
): ExportTarget | null {
  const [exportedName, ...rest] = exportPath;
  if (exportedName === undefined) return null;
  for (const statement of module.statements) {
    if (statement.type === "ExportNamedDeclaration") {
      if (declarationDeclaresName(statement.declaration, exportedName)) {
        if (rest.length === 0) return { filename, key, localName: exportedName, module };
        const nested = namespaceModule(module, exportedName);
        return nested === null
          ? null
          : exportedExportTarget(filename, nested, rest, resolving, key);
      }
      for (const specifier of statement.specifiers) {
        const exported =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value;
        if (exported !== exportedName) continue;
        const local =
          specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
        return statement.source === null
          ? localExportTarget(filename, module, [local, ...rest], resolving, key)
          : importedExportTarget(filename, statement.source.value, [local, ...rest], resolving);
      }
    }
    if (
      statement.type === "ExportDefaultDeclaration" &&
      exportedName === "default" &&
      rest.length === 0
    ) {
      const localName =
        statement.declaration?.type === "Identifier"
          ? statement.declaration.name
          : declarationName(statement.declaration);
      return localName === null ? null : { filename, key, localName, module };
    }
    if (statement.type === "ExportAllDeclaration") {
      const namespaceExport = statement.exported;
      let sourcePath = exportPath;
      if (namespaceExport !== null && namespaceExport !== undefined) {
        const namespaceName =
          namespaceExport.type === "Identifier" ? namespaceExport.name : namespaceExport.value;
        if (namespaceName !== exportedName || rest.length === 0) continue;
        sourcePath = rest;
      }
      const target = importedExportTarget(filename, statement.source.value, sourcePath, resolving);
      if (target !== null) return target;
    }
  }
  return null;
}

function importedExportTarget(
  containingFile: string,
  moduleSpecifier: string,
  exportPath: readonly string[],
  resolving: ReadonlySet<string>,
): ExportTarget | null {
  const filename = resolveModule(containingFile, moduleSpecifier);
  if (filename === null) return null;
  const key = [filename, ...exportPath].join("\0");
  if (resolving.has(key)) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(key);
  return exportedExportTarget(filename, parsedModule(filename), exportPath, nextResolving, key);
}

function importedTypeDefinition(
  containingFile: string,
  moduleSpecifier: string,
  exportPath: readonly string[],
  arguments_: readonly PortableTypeArgument[],
  resolving: ReadonlySet<string>,
): ResolvedPortableType | null {
  const target = importedExportTarget(containingFile, moduleSpecifier, exportPath, resolving);
  return target === null
    ? null
    : localTypeDefinition(target.filename, target.module, target.localName, arguments_, target.key);
}

/** Build import resolution for portable type queries at one program boundary. */
export function createImportedTypeResolver(
  containingFile: string,
  statements: readonly PortableModuleItem[],
): PortableTypeResolver {
  const module = {
    environment: createPortableModuleTypeEnvironment(statements),
    statements,
  };
  return importedTypeResolver(containingFile, module, new Set());
}

/** Create import resolution once, when a rule first inspects a node. */
export function createLazyImportedTypeResolver(
  getContainingFile: () => string,
): (node: ESTree.Node) => PortableTypeResolver {
  let resolver: PortableTypeResolver | null = null;
  return (node) => {
    if (resolver !== null) return resolver;
    let root = node;
    while (root.parent !== null) root = root.parent;
    resolver = createImportedTypeResolver(
      getContainingFile(),
      root.type === "Program" ? root.body : [],
    );
    return resolver;
  };
}
