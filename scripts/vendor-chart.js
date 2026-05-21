#!/usr/bin/env node
/**
 * Copy Chart.js UMD bundle into public/ for offline use (no CDN).
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist');
const candidates = ['chart.umd.min.js', 'chart.umd.js'];
const src = candidates.map((name) => path.join(distDir, name)).find((p) => fs.existsSync(p));

const destDir = path.join(__dirname, '..', 'public', 'vendor', 'chart.js');
const dest = path.join(destDir, 'chart.umd.min.js');

if (!src) {
    console.error('[vendor-chart] chart.js UMD bundle not found. Run: npm install');
    process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[vendor-chart] Copied ${path.basename(src)} → public/vendor/chart.js/chart.umd.min.js`);
