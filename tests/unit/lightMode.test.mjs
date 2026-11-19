// The store keeps ONE light look on every device (no automatic darkening).
//   node --test tests/unit/lightMode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('index.html declares a light-only colour scheme before any stylesheet', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const meta = html.indexOf('<meta name="color-scheme" content="only light" />');
  assert.ok(meta > 0, 'color-scheme meta present');
  const firstStyle = Math.min(...['<link rel="stylesheet"', '<style', '<script'].map((s) => (html.indexOf(s) < 0 ? Infinity : html.indexOf(s))));
  assert.ok(meta < firstStyle, 'declared before styles / scripts (applies from the first paint)');
});

test('the stylesheet repeats it on :root and gives html / body a light background', () => {
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  assert.match(css, /:root\s*\{\s*color-scheme:\s*only light;\s*\}/);
  assert.match(css, /html\s*\{[^}]*background-color:\s*#faf7f1/);
  assert.match(css, /body\s*\{[^}]*background-color:\s*#faf7f1/);
});

test('no dark-mode variant anywhere (Tailwind darkMode off, no dark: classes, no prefers-color-scheme: dark rules)', () => {
  const tw = readFileSync(join(ROOT, 'tailwind.config.cjs'), 'utf8');
  assert.doesNotMatch(tw, /darkMode\s*:/);
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/);
});
