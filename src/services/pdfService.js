'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');

function getBrowserPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.env.EDGE_PATH && fs.existsSync(process.env.EDGE_PATH)) {
    return process.env.EDGE_PATH;
  }
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function htmlToPdf(html, options = {}) {
  const { landscape = false, format = 'A4', cssPageSize = false } = options;

  const executablePath = getBrowserPath();
  if (!executablePath) {
    throw new Error('Browser executable for PDF generation not found. Set PUPPETEER_EXECUTABLE_PATH or install Chromium/Edge.');
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 }).catch(async (e) => {
      // Offline (e.g. web fonts unreachable) — continue with whatever has loaded
      console.warn('setContent wait warning:', e.message);
    });
    await page.evaluateHandle('document.fonts.ready');

    const pdfOptions = cssPageSize
      ? {
          // Templates define @page size/orientation/margins themselves
          // (allows landscape page 1 + portrait page 2 in one document)
          preferCSSPageSize: true,
          printBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 }
        }
      : {
          format,
          landscape,
          printBackground: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        };

    const pdfData = await page.pdf(pdfOptions);
    // puppeteer >= 22 returns a Uint8Array; Express would JSON-encode it,
    // so convert to a Node Buffer to send raw PDF bytes.
    return Buffer.from(pdfData);
  } finally {
    await browser.close();
  }
}

module.exports = {
  htmlToPdf
};
