#!/usr/bin/env node
const { URL } = require('url');
const http = require('http');
const https = require('https');

function checkOnce(targetUrl, timeout) {
  return new Promise((resolve) => {
    const urlObj = new URL(targetUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      timeout
    };
    const req = lib.request(options, (res) => {
      const status = res.statusCode;
      res.resume();
      res.on('end', () => resolve({ ok: status >= 200 && status < 300, status }));
    });
    req.on('timeout', () => { req.abort(); resolve({ ok: false, status: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, status: err.code || String(err) }));
    req.end();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  const urlArg = args.url || 'http://localhost:3000';
  const pathArg = args.path || '/';
  const retries = parseInt(args.retries || 3, 10);
  const timeout = parseInt(args.timeout || 5000, 10);
  const fullUrl = (urlArg.endsWith('/') && pathArg.startsWith('/')) ? urlArg.slice(0, -1) + pathArg : urlArg + pathArg;
  for (let attempt = 1; attempt <= retries; attempt++) {
    process.stdout.write(`Attempt ${attempt}/${retries} -> ${fullUrl} ... `);
    const res = await checkOnce(fullUrl, timeout);
    if (res.ok) {
      console.log(`OK (status ${res.status})`);
      process.exit(0);
    } else {
      console.log(`FAILED (${res.status})`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000));
    }
  }
  process.exit(2);
}

async function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

async function runOnce(fullUrl, retries, timeout) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    process.stdout.write(`Attempt ${attempt}/${retries} -> ${fullUrl} ... `);
    const res = await checkOnce(fullUrl, timeout);
    if (res.ok) {
      console.log(`OK (status ${res.status})`);
      return { ok: true, status: res.status };
    } else {
      console.log(`FAILED (${res.status})`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { ok: false };
}

async function main() {
  const args = await parseArgs();
  const urlArg = args.url || 'http://localhost:3000';
  const pathArg = args.path || '/';
  const retries = parseInt(args.retries || 3, 10);
  const timeout = parseInt(args.timeout || 5000, 10);
  const interval = parseInt(args.interval || 0, 10); // ms, 0 = single-run
  const fullUrl = (urlArg.endsWith('/') && pathArg.startsWith('/')) ? urlArg.slice(0, -1) + pathArg : urlArg + pathArg;

  if (interval > 0) {
    console.log(`Starting continuous healthcheck for ${fullUrl} every ${interval}ms (Ctrl+C to stop)`);
    while (true) {
      const res = await runOnce(fullUrl, retries, timeout);
      await new Promise(r => setTimeout(r, interval));
    }
  } else {
    const res = await runOnce(fullUrl, retries, timeout);
    process.exit(res.ok ? 0 : 2);
  }
}

main();
