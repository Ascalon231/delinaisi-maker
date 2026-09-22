const { existsSync } = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Cari executable chromium yang bisa dijalankan:
// 1) PW_CHROME (env), 2) system chromium, 3) instalasi playwright di .test/pw-browsers.
function runnable(p) {
  if (!p || !existsSync(p)) return false;
  try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

const candidates = [
  process.env.PW_CHROME,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  path.join(__dirname, '.test/pw-browsers/chromium-1243/chrome-linux64/chrome')
].filter(Boolean);
const exe = candidates.find(runnable);
if (!exe) console.error('PERINGATAN: tidak menemukan chromium yang bisa dijalankan');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './test',
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 850 },
    launchOptions: {
      executablePath: exe || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ]
};
module.exports = config;
