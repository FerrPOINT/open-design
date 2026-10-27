import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { expect, it } from 'vitest';

it('compiles the installed Base palette in the same pipeline as its utilities without global preflight', async () => {
  const file = fileURLToPath(new URL('../../src/pdlc/pdlc.css', import.meta.url));
  const result = await postcss([tailwindcss()]).process(readFileSync(file, 'utf8'), { from: file });
  const declarations = new Map<string, Record<string, string>>();
  let globalBoxReset = false;
  result.root.walkRules(rule => {
    const values: Record<string, string> = {};
    rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
    declarations.set(rule.selector, values);
    if (rule.selector.startsWith('*') && values['box-sizing'] === 'border-box') globalBoxReset = true;
  });
  expect(declarations.get('.bg-surface')?.['background-color']).toBe('var(--color-surface)');
  expect(declarations.get('.text-text-primary')?.color).toBe('var(--color-text-primary)');
  expect(declarations.get('.bg-danger')?.['background-color']).toBe('var(--color-danger)');
  expect(globalBoxReset).toBe(false);
}, 30000);
