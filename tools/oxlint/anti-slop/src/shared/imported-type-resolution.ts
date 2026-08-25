import { readFileSync } from "node:fs";
import path from "node:path";
import type { ESTree } from "@oxlint/plugins";
import { parseSync } from "oxc-parser";
import ts from "typescript";

import {
  createPortableModuleTypeEnvironment,
  type ResolvedPortableType,
  type PortableTypeArgument,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
} from "./portable-type-resolution.ts";

import type { PortableModuleItem, PortableNode } from "./portable-ast.ts";

type ParsedModule = {
  readonly environment: PortableTypeEnvironment;
  readonly statements: readonly PortableModuleItem[];
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
  return (typeNameParts, arguments_) => {
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
  };
}

function localTypeDefinition(
  filename: string,
  module: ParsedModule,
  localName: string,
  arguments_: readonly PortableTypeArgument[],
  resolving: ReadonlySet<string>,
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
  const imported = importedBinding(module, localName);
  return imported === null || imported.kind === "namespace"
    ? null
    : importedTypeDefinition(
        filename,
        imported.moduleSpecifier,
        [imported.exportedName],
        arguments_,
        resolving,
      );
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
    : { environment: createPortableModuleTypeEnvironment(statements), statements };
}

function localPathDefinition(
  filename: string,
  module: ParsedModule,
  exportPath: readonly string[],
  arguments_: readonly PortableTypeArgument[],
  resolving: ReadonlySet<string>,
  key: string,
): ResolvedPortableType | null {
  const [localName, ...rest] = exportPath;
  if (localName === undefined) return null;
  const imported = importedReference(module, exportPath);
  if (imported !== null) {
    return importedTypeDefinition(
      filename,
      imported.moduleSpecifier,
      imported.exportPath,
      arguments_,
      resolving,
    );
  }
  if (rest.length === 0) {
    return localTypeDefinition(filename, module, localName, arguments_, resolving, key);
  }
  const nestedModule = namespaceModule(module, localName);
  return nestedModule === null
    ? null
    : exportedPathDefinition(filename, nestedModule, rest, arguments_, resolving, key);
}

function exportedPathDefinition(
  filename: string,
  module: ParsedModule,
  exportPath: readonly string[],
  arguments_: readonly PortableTypeArgument[],
  resolving: ReadonlySet<string>,
  key: string,
): ResolvedPortableType | null {
  const [exportedName, ...rest] = exportPath;
  if (exportedName === undefined) return null;

  for (const statement of module.statements) {
    if (statement.type === "ExportNamedDeclaration") {
      if (declarationName(statement.declaration) === exportedName) {
        if (rest.length === 0) {
          return localTypeDefinition(filename, module, exportedName, arguments_, resolving, key);
        }
        const nestedModule = namespaceModule(module, exportedName);
        return nestedModule === null
          ? null
          : exportedPathDefinition(filename, nestedModule, rest, arguments_, resolving, key);
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
          ? localPathDefinition(filename, module, [local, ...rest], arguments_, resolving, key)
          : importedTypeDefinition(
              filename,
              statement.source.value,
              [local, ...rest],
              arguments_,
              resolving,
            );
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
      return localName === null
        ? null
        : localTypeDefinition(filename, module, localName, arguments_, resolving, key);
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
      const target = importedTypeDefinition(
        filename,
        statement.source.value,
        sourcePath,
        arguments_,
        resolving,
      );
      if (target !== null) return target;
    }
  }
  return null;
}

function importedTypeDefinition(
  containingFile: string,
  moduleSpecifier: string,
  exportPath: readonly string[],
  arguments_: readonly PortableTypeArgument[],
  resolving: ReadonlySet<string>,
): ResolvedPortableType | null {
  const filename = resolveModule(containingFile, moduleSpecifier);
  if (filename === null) return null;
  const key = `${filename}\0${exportPath.join("\0")}`;
  if (resolving.has(key)) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(key);
  const module = parsedModule(filename);
  return exportedPathDefinition(filename, module, exportPath, arguments_, nextResolving, key);
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
