import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
describe('shared sky design tokens', () => {
  it('defines blue, sky and lavender surfaces rather than the old green palette', () => {
    expect(token('bg')).toBe('#f5f8ff');
    expect(token('accent')).toBe('#4264d7');
    expect(token('lavender')).toBe('#ede9ff');
    expect(token('sky')).toBe('#e4f2ff');
  });
  it.each([['ink','bg'],['muted','bg'],['muted','surface-soft'],['accent','surface'],['on-accent','accent'],['accent-ink','accent-soft'],['muted','sky'],['muted','lavender']])('%s on %s meets normal text contrast', (foreground, background) => {
    const a = token(foreground), b = token(background);
    expect(a).toBeDefined();expect(b).toBeDefined();
    const values = [luminance(a!), luminance(b!)].sort((x,y) => y-x);
    expect((values[0]! + .05) / (values[1]! + .05)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['surface','surface-soft','bg'])('focus ring has at least 3:1 contrast against %s', background => {
    const values = [luminance(token('focus')!), luminance(token(background)!)].sort((x,y) => y-x);
    expect((values[0]! + .05) / (values[1]! + .05)).toBeGreaterThanOrEqual(3);
  });
});
