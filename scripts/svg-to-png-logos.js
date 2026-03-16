#!/usr/bin/env node
/**
 * Convert SVG placeholder logos to PNG.
 * Run: node scripts/svg-to-png-logos.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.join(__dirname, '..', 'public', 'images', 'platforms');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));

(async () => {
  for (const file of files) {
    const id = file.replace('.svg', '');
    const svgPath = path.join(dir, file);
    const pngPath = path.join(dir, `${id}.png`);
    if (fs.existsSync(pngPath)) {
      console.log(`Skipped ${id}.png (already exists, keeping your file)`);
      continue;
    }
    try {
      let buf;
      try {
        buf = await sharp(svgPath)
          .trim({ threshold: 15 })
          .png()
          .toBuffer();
      } catch {
        buf = await sharp(svgPath).png().toBuffer();
      }
      const meta = await sharp(buf).metadata();
      const w = meta.width || 64;
      const h = meta.height || 64;
      const size = Math.max(w, h, 64);
      const pad = 20;
      await sharp(buf)
        .resize(size, size)
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 248, g: 250, b: 252, alpha: 1 } })
        .png()
        .toFile(pngPath);
      console.log(`Converted ${id}.svg -> ${id}.png`);
    } catch (e) {
      console.warn(`Failed ${id}:`, e.message);
    }
  }
  console.log('Done.');
})();
