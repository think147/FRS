const http = require('http');
const querystring = require('querystring');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const loginBody = querystring.stringify({ username: 'admin', password: 'password123' });
    const login = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(loginBody)
      }
    }, loginBody);

    console.log('LOGIN', login.statusCode, login.body);
    const cookie = login.headers['set-cookie'] ? login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';

    const session = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/session',
      method: 'GET',
      headers: { Cookie: cookie }
    });
    console.log('SESSION', session.statusCode, session.body);

    const csv = await request({ hostname: 'localhost', port: 3000, path: '/api/attendance/export?type=csv', method: 'GET' });
    console.log('CSV', csv.statusCode, csv.headers['content-type']);

    const xlsx = await request({ hostname: 'localhost', port: 3000, path: '/api/attendance/export?type=xlsx', method: 'GET' });
    console.log('XLSX', xlsx.statusCode, xlsx.headers['content-type']);

    const pdf = await request({ hostname: 'localhost', port: 3000, path: '/api/attendance/export?type=pdf', method: 'GET' });
    console.log('PDF', pdf.statusCode, pdf.headers['content-type']);
  } catch (err) {
    console.error('ERROR', err.message);
    process.exit(1);
  }
})();
