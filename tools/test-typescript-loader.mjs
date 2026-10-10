import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const project = fileURLToPath(new URL('../', import.meta.url));
const sourceRoots = new Set(['src', 'tests', 'tools']);

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const relative = path.relative(project, filename);
  const parts = relative.split(path.sep);
  if (!filename.endsWith('.ts') || path.isAbsolute(relative) ||
      !sourceRoots.has(parts[0]) || parts.includes('node_modules')) {
    return nextLoad(url, context);
  }

  const result = ts.transpileModule(await readFile(filename, 'utf8'), {
    fileName: relative,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      inlineSourceMap: true,
      inlineSources: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new SyntaxError(ts.formatDiagnostics(errors, {
      getCurrentDirectory: () => project,
      getCanonicalFileName: name => name,
      getNewLine: () => '\n',
    }));
  }
  return {format: 'module', source: result.outputText, shortCircuit: true};
}
