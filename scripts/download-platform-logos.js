#!/usr/bin/env node
/**
 * Download platform logos from Clearbit to public/images/platforms/
 * Run: node scripts/download-platform-logos.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PLATFORMS = [
  { id: 'n8n', domain: 'n8n.io' },
  { id: 'unqork', domain: 'unqork.com' },
  { id: 'make', domain: 'make.com' },
  { id: 'zapier', domain: 'zapier.com' },
  { id: 'power-automate', domain: 'microsoft.com' },
  { id: 'pipedream', domain: 'pipedream.com' },
  { id: 'camunda', domain: 'camunda.com' },
  { id: 'temporal', domain: 'temporal.io' },
  { id: 'retool', domain: 'retool.com' },
  { id: 'airtable', domain: 'airtable.com' },
  { id: 'monday', domain: 'monday.com' },
  { id: 'process-street', domain: 'processstreet.com' },
  { id: 'smartsuite', domain: 'smartsuite.com' },
  { id: 'workato', domain: 'workato.com' },
  { id: 'tray-io', domain: 'tray.io' },
];

const outDir = path.join(__dirname, '..', 'public', 'images', 'platforms');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

(async () => {
  for (const p of PLATFORMS) {
    const url = `https://logo.clearbit.com/${p.domain}`;
    try {
      const buf = await download(url);
      const outPath = path.join(outDir, `${p.id}.png`);
      fs.writeFileSync(outPath, buf);
      console.log(`Downloaded ${p.id}`);
    } catch (e) {
      console.warn(`Failed ${p.id}:`, e.message);
    }
  }
  console.log('Done.');
})();
