#!/usr/bin/env node
// Rasterizes web/public/pwa/logo.svg into the maskable PNG icons
// vite-plugin-pwa's manifest references (PLAN.md §9: "generated maskable
// icons (512/192) from a source SVG logo"). Kept as a permanent, re-runnable
// repo tool (not a one-off) so the PNGs can be regenerated if the source
// SVG ever changes — same "reproducible generator" precedent as
// scripts/generate-example-icons.mjs.
//
// Uses the system `inkscape` CLI to rasterize (no new npm dependency: the
// standard vite-plugin-pwa workflow is @vite-pwa/assets-generator, which
// pulls in sharp — a much larger addition than shelling out to a CLI tool
// already installed on this machine for one-time icon generation; see
// DECISIONS.md "Phase 6" for the full rationale). If `inkscape` isn't
// available, falls back to ImageMagick's `magick`/`convert`, both of which
// were also confirmed present.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'pwa');
const SOURCE_SVG = path.join(OUT_DIR, 'logo.svg');
const SIZES = [192, 512];

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function rasterize(size, outPath) {
  if (commandExists('inkscape')) {
    execFileSync('inkscape', [
      '--export-type=png',
      `--export-filename=${outPath}`,
      '-w',
      String(size),
      '-h',
      String(size),
      SOURCE_SVG,
    ]);
    return 'inkscape';
  }
  const magick = commandExists('magick') ? 'magick' : 'convert';
  execFileSync(magick, ['-background', 'none', '-resize', `${size}x${size}`, SOURCE_SVG, outPath]);
  return magick;
}

if (!existsSync(SOURCE_SVG)) {
  console.error(`source SVG not found: ${SOURCE_SVG}`);
  process.exit(1);
}

for (const size of SIZES) {
  const outPath = path.join(OUT_DIR, `pwa-maskable-${size}x${size}.png`);
  const tool = rasterize(size, outPath);
  console.log(`Generated ${outPath} (via ${tool})`);
}
