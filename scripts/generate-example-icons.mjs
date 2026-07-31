#!/usr/bin/env node
// One-off generator for workspace.example/icons/*.svg — simple 16x16 grid
// pixel-art SVGs (hand-generated in code, no external art). Deterministic
// (seeded PRNG) so re-running reproduces the same set. See PLAN.md §4 /
// §11 Phase 1 ("ship >=24 pixel-art style SVGs... generate in code").
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ICON_COUNT = 28;
const GRID = 16;
const CELL = 8; // px per cell -> 128x128 viewBox

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'workspace.example',
  'icons',
);

const PALETTE = [
  '#e63946',
  '#f1c453',
  '#2a9d8f',
  '#457b9d',
  '#a663cc',
  '#f4a261',
  '#06d6a0',
  '#ef476f',
  '#118ab2',
  '#ffd166',
];

// mulberry32: tiny deterministic PRNG, seeded per-icon for reproducibility.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateIcon(index) {
  const rand = mulberry32(index * 104729 + 17);
  const colors = [PALETTE[Math.floor(rand() * PALETTE.length)], PALETTE[Math.floor(rand() * PALETTE.length)]];
  const half = GRID / 2;
  // Fill a random symmetric (mirrored left/right) pattern on a half-grid.
  const cells = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < half; x++) {
      if (rand() < 0.42) {
        const color = colors[(x + y) % colors.length];
        cells.push({ x, y, color });
        cells.push({ x: GRID - 1 - x, y, color });
      }
    }
  }

  const rects = cells
    .map(
      (c) => `<rect x="${c.x * CELL}" y="${c.y * CELL}" width="${CELL}" height="${CELL}" fill="${c.color}"/>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID * CELL} ${GRID * CELL}">${rects}</svg>\n`;
}

mkdirSync(OUT_DIR, { recursive: true });

for (let i = 0; i < ICON_COUNT; i++) {
  const name = `icon-${String(i + 1).padStart(2, '0')}.svg`;
  writeFileSync(path.join(OUT_DIR, name), generateIcon(i), 'utf8');
}

console.log(`Generated ${ICON_COUNT} icons in ${OUT_DIR}`);
