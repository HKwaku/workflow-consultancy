#!/usr/bin/env node
/** Create SVG placeholder logos for platforms */
const fs = require('fs');
const path = require('path');

const platforms = [
  { id: 'n8n', letter: 'n', color: '#ff6d5a' },
  { id: 'unqork', letter: 'U', color: '#6366f1' },
  { id: 'make', letter: 'M', color: '#6d28d9' },
  { id: 'zapier', letter: 'Z', color: '#ff4a00' },
  { id: 'power-automate', letter: 'P', color: '#5c2d91' },
  { id: 'pipedream', letter: 'P', color: '#00b894' },
  { id: 'camunda', letter: 'C', color: '#ff6b00' },
  { id: 'temporal', letter: 'T', color: '#ff6b6b' },
  { id: 'retool', letter: 'R', color: '#0d9488' },
  { id: 'airtable', letter: 'A', color: '#18bfff' },
  { id: 'monday', letter: 'M', color: '#ff3d57' },
  { id: 'process-street', letter: 'P', color: '#5c6bc0' },
  { id: 'smartsuite', letter: 'S', color: '#6366f1' },
  { id: 'workato', letter: 'W', color: '#ff6b35' },
  { id: 'tray-io', letter: 'T', color: '#4f46e5' },
];

const dir = path.join(__dirname, '..', 'public', 'images', 'platforms');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

platforms.forEach((p) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${p.color}"/><text x="12" y="17" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="white" text-anchor="middle">${p.letter}</text></svg>`;
  fs.writeFileSync(path.join(dir, `${p.id}.svg`), svg);
  console.log(`Created ${p.id}.svg`);
});
console.log('Done.');
