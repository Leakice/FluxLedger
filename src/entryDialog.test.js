import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, compileTemplate } from '@vue/compiler-sfc';

test('entry dialog calls the loan predicate and compiles all transaction card branches',async()=>{
  const source=await readFile(new URL('./components/EntryDialog.vue',import.meta.url),'utf8');
  const {descriptor}=parse(source);
  assert.match(descriptor.template.content,/v-if="isLoan\(\)"/);
  const compiled=compileTemplate({source:descriptor.template.content,filename:'EntryDialog.vue',id:'entry-dialog'});
  assert.deepEqual(compiled.errors,[]);
  assert.match(compiled.code,/isLoan\(\)/);
  assert.match(descriptor.template.content,/form\.type!==['"]credit['"]/);
  assert.match(descriptor.template.content,/v-else/);
  assert.match(descriptor.scriptSetup.content,/resolveCreditAccountCard\(props\.cards, account\)/);
  assert.doesNotMatch(descriptor.scriptSetup.content,/creditAccountCards\.find\(card => card\.name === account\)\?\.id/);
});
