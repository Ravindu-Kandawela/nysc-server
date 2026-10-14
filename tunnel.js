'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
const cloudflaredPath = path.join(__dirname, 'bin', 'cloudflared.exe');

if (!fs.existsSync(cloudflaredPath)) {
  console.error('Error: cloudflared.exe not found at:', cloudflaredPath);
  process.exit(1);
}

console.log('Starting Cloudflare Tunnel to port 5173...');
console.log('(This generates a 100% free secure HTTPS public link for students)\n');

const child = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:5173'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let foundUrl = false;

function updateEnv(url) {
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('CLIENT_URL=')) {
      envContent = envContent.replace(/CLIENT_URL=.*/g, `CLIENT_URL=${url}`);
    } else {
      envContent += `\nCLIENT_URL=${url}`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`Updated server/.env CLIENT_URL to: ${url}`);
  } catch (err) {
    console.error('Failed to update .env:', err.message);
  }
}

function handleData(data) {
  const text = data.toString();
  // Cloudflare prints: https://xxxx.trycloudflare.com
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !foundUrl) {
    foundUrl = true;
    const publicUrl = match[0];
    updateEnv(publicUrl);

    console.log('\n================================================================');
    console.log('🎉 100% FREE CLOUDFLARE PUBLIC TUNNEL IS LIVE!');
    console.log('================================================================');
    console.log(`🌐 Public Web Address:  ${publicUrl}`);
    console.log(`📲 Students can open submission links from any phone or home PC!`);
    console.log('================================================================\n');
    console.log('Press Ctrl + C in this window anytime to stop the tunnel.');
  }
}

child.stdout.on('data', handleData);
child.stderr.on('data', handleData);

child.on('close', (code) => {
  console.log(`Tunnel closed (exit code ${code})`);
  // Reset CLIENT_URL back to localhost
  try {
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/CLIENT_URL=.*/g, 'CLIENT_URL=http://localhost:5173');
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('Reset CLIENT_URL back to http://localhost:5173');
  } catch (e) { /* ignore */ }
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  child.kill();
});
process.on('SIGTERM', () => {
  child.kill();
});
