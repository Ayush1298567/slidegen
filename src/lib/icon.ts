// Convert a kebab-case lucide icon name (e.g. "bar-chart-3") into an SVG string.
// Used by the slide HTML renderer + PPTX renderer for the new "lucide icon per slide".

import { icons as lucideIcons } from 'lucide';

type IconNode = [tag: string, attrs: Record<string, string | number>][];

function pascalCase(kebab: string): string {
  return kebab
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function lookup(name: string): IconNode | undefined {
  if (!name) return undefined;
  const direct = (lucideIcons as Record<string, IconNode>)[name];
  if (direct) return direct;
  const pc = pascalCase(name);
  const hit = (lucideIcons as Record<string, IconNode>)[pc];
  return hit;
}

const FALLBACK_NODE: IconNode = [
  ['polyline', { points: '9 18 15 12 9 6', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' }],
];

function attrsString(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${String(v)}"`)
    .join(' ');
}

export function lucideSvg(name: string | undefined, opts: { size?: number | string; color?: string; strokeWidth?: number } = {}): string {
  const size = opts.size ?? 24;
  const color = opts.color ?? 'currentColor';
  const sw = opts.strokeWidth ?? 2;
  const node = lookup(name ?? '') ?? FALLBACK_NODE;
  const children = node
    .map(([tag, attrs]) => `<${tag} ${attrsString(attrs)}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

export function hasLucideIcon(name: string | undefined): boolean {
  return Boolean(lookup(name ?? ''));
}
