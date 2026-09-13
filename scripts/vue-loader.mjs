// Node ESM customization hooks: compile Vue SFCs on import and resolve the
// extension-less relative specifiers the Vite build allows inside src/.
// Mirrors the vite-plugin-vue pipeline: compileScript (which returns the full
// setup bindings object) + compileTemplate, with the render fn attached to a
// named component so tests can reach the setup state through app._instance.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (isRelative && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.js', context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (!url.split('?')[0].endsWith('.vue')) return nextLoad(url, context);
  const { parse, compileScript, compileTemplate } = await import('vue/compiler-sfc');
  const filename = fileURLToPath(url.split('?')[0]);
  const source = readFileSync(filename, 'utf8');
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) {
    throw new Error(`SFC compile error in ${filename}: ${errors.map(e => e.message).join('; ')}`);
  }
  const compiled = compileScript(descriptor, { id: url, genDefaultAs: '_sfc_main' });
  let code = typeof compiled === 'string' ? compiled : compiled.content;
  if (descriptor.template && descriptor.template.content.trim()) {
    const template = compileTemplate({
      id: url,
      filename,
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: compiled.bindings },
    });
    if (template.errors.length) {
      throw new Error(`SFC template error in ${filename}: ${template.errors.map(e => e.message).join('; ')}`);
    }
    code += `\n${template.code}\n_sfc_main.render = render;\nexport default _sfc_main;\n`;
  }
  return { format: 'module', source: code, shortCircuit: true };
}
