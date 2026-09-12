// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach, expect, it} from 'vitest';

function mountStyles() {
  const globalCSS = readFileSync('apps/web/app/globals.css', 'utf8');
  const style = document.createElement('style');
  // Exercise the actual inherited global label direction without importing Tailwind.
  style.textContent = globalCSS.match(/(?:^|\n)label\{[^}]+\}/)![0]
    + readFileSync('apps/web/components/character-library.module.css', 'utf8')
    + readFileSync('apps/web/components/story-assets.module.css', 'utf8');
  document.head.append(style);
  document.body.innerHTML = '<form class="form"><fieldset class="fields"><section class="asset"><label class="rights"><input type="checkbox"><span>我确认有权使用这张图片</span></label><button disabled>上传图片</button></section></fieldset></form>';
}
afterEach(() => {document.head.innerHTML = ''; document.body.innerHTML = '';});

it('keeps rights checkbox beside the wrapping text despite inherited form styles', () => {
  mountStyles();
  const label = getComputedStyle(document.querySelector('.rights')!);
  expect(label.display).toBe('flex');
  expect(label.flexDirection).toBe('row');
  expect(label.alignItems).toBe('flex-start');
  const text = getComputedStyle(document.querySelector('.rights span')!);
  expect(parseFloat(text.minWidth)).toBe(0);
  expect(text.overflowWrap).toBe('anywhere');
  expect(getComputedStyle(document.querySelector('input')!).flexShrink).toBe('0');
});

it('retains an outlined light action surface when upload is disabled', () => {
  mountStyles();
  const button = document.querySelector('button')!;
  const disabled = getComputedStyle(button);
  // JSDOM does not resolve custom properties used by the background shorthand.
  const rules = Array.from(document.querySelector('style')!.sheet!.cssRules) as CSSStyleRule[];
  const base = rules.find(rule => rule.selectorText === '.asset>button')!;
  expect(base.style.getPropertyValue('background')).toBe('var(--accent-soft)');
  expect(disabled.borderTopStyle).toBe('solid');
  expect(disabled.borderRadius).toBe('10px');
  expect(disabled.cursor).toBe('not-allowed');
  button.disabled = false;
  const enabled = getComputedStyle(button);
  expect(Number(disabled.opacity)).toBeLessThan(1);
  expect(enabled.borderTopStyle).toBe('solid');
  expect(enabled.cursor).toBe('pointer');
});
