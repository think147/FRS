const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const Jimp = require('jimp');
const multer = require('multer');
const qrcode = require('qrcode');
const session = require('express-session');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const cors = require('cors');
const selfsigned = require('selfsigned');

const app = express();
const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ATT_FILE = path.join(DATA_DIR, 'attendance.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ATT_FILE)) fs.writeFileSync(ATT_FILE, '[]');

app.use(cors());

// Allow camera/mic via Permissions-Policy and COOP/COEP headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'replace-with-secure-secret', resave: false, saveUninitialized: true }));

// Clean URLs: redirect any .html request to its clean extensionless URL
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
app.get('/user.html', (req, res) => res.redirect(301, '/user'));

// Route aliases for clean URLs
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/kiosk', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/user', (req, res) => res.sendFile(path.join(ROOT, 'public', 'user.html')));

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

migrateUsers();

// Serve local html5-qrcode bundle so frontend doesn't rely on CDN
app.get('/libs/html5-qrcode.min.js', (req, res) => {
  const libPath = path.join(ROOT, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js');
  if (fs.existsSync(libPath)) return res.sendFile(libPath);
  res.status(404).send('html5-qrcode not found');
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '';
    cb(null, file.fieldname + '-' + unique + ext);
  }
});
const upload = multer({ storage });

function readUsers() {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
    return users.map(normalizeUser);
  } catch (e) { return []; }
}
function writeUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function readAttendance() {
  try { return JSON.parse(fs.readFileSync(ATT_FILE, 'utf8') || '[]'); }
  catch (e) { return []; }
}
function writeAttendance(entries) { fs.writeFileSync(ATT_FILE, JSON.stringify(entries, null, 2)); }

function migrateUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8') || '[]';
    const users = JSON.parse(raw);
    let changed = false;
    const migrated = users.map(user => {
      const normalized = normalizeUser(user);
      if (JSON.stringify(normalized) !== JSON.stringify(user)) {
        changed = true;
      }
      return normalized;
    });
    if (changed) {
      writeUsers(migrated);
      console.log('Migrated user records to normalized face-hash schema');
    }
  } catch (e) {
    console.error('User migration failed', e);
  }
}

function normalizeUser(user) {
  const normalized = Object.assign({}, user);
  if (!Array.isArray(normalized.imageAHashes)) {
    normalized.imageAHashes = normalized.imageAHashes ? [normalized.imageAHashes] : [];
  }
  if (!Array.isArray(normalized.faceHashes)) {
    normalized.faceHashes = normalized.faceHashes ? [normalized.faceHashes] : [];
  }
  if (!Array.isArray(normalized.images)) {
    normalized.images = normalized.images ? normalized.images : normalized.image ? [normalized.image] : [];
  }
  if (!normalized.image && Array.isArray(normalized.images) && normalized.images.length) {
    normalized.image = normalized.images[0];
  }
  if (normalized.imageAHash && !normalized.imageAHashes.includes(normalized.imageAHash)) {
    normalized.imageAHashes.push(normalized.imageAHash);
  }
  const currentSec = (normalized.section || '').trim();
  if (!currentSec || currentSec.toLowerCase() === 'unassigned') {
    normalized.section = ((normalized.designation || '').trim()) || 'General';
  } else {
    normalized.section = currentSec;
  }
  return normalized;
}

// compute a simple average hash (aHash) for an image buffer
async function computeAHashFromBuffer(buf) {
  try {
    const img = await Jimp.read(buf);
    img.resize(8, 8).grayscale();
    const vals = [];
    let sum = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const rgba = Jimp.intToRGBA(img.getPixelColor(x, y));
        const v = rgba.r; // grayscale -> r == g == b
        vals.push(v);
        sum += v;
      }
    }
    const avg = sum / vals.length;
    let bits = '';
    vals.forEach(v => bits += (v > avg ? '1' : '0'));
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      const nib = bits.slice(i, i + 4);
      hex += parseInt(nib, 2).toString(16);
    }
    return hex.padStart(16, '0');
  } catch (e) {
    return null;
  }
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  // Simple demo credentials (change in production)
  if (username === 'admin' && password === 'password123') {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Development helper: set admin session quickly (only for local testing)
app.get('/dev/login', (req, res) => {
  req.session.isAdmin = true;
  res.send('<html><body>Dev admin session set. <a href="/admin">Go to admin</a></body></html>');
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

app.post('/api/users', upload.array('faces', 10), async (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const { name, email, section, designation, code } = req.body;
  const files = req.files || [];
  if (files.length < 4) return res.status(400).json({ error: 'Please upload at least 4 face images from different angles' });
  const users = readUsers();
  const id = Date.now().toString();

  const finalSection = (section && section.trim() && section.trim().toLowerCase() !== 'unassigned')
    ? section.trim()
    : ((designation && designation.trim()) ? designation.trim() : 'General');

  const user = {
    id,
    name: (name || '').trim(),
    email: (email || '').trim(),
    designation: (designation || '').trim(),
    code: (code || '').trim(),
    section: finalSection,
    images: files.map(file => '/uploads/' + path.basename(file.path)),
    faceHashes: [],
    imageAHashes: [],
    createdAt: new Date().toISOString()
  };
  for (const file of files) {
    try {
      const buf = fs.readFileSync(file.path);
      user.faceHashes.push(crypto.createHash('sha1').update(buf).digest('hex'));
      const ah = await computeAHashFromBuffer(buf);
      if (ah) user.imageAHashes.push(ah);
    } catch (e) { /* ignore hashing errors */ }
  }
  users.push(user);
  writeUsers(users);
  res.json(user);
});

app.get('/api/users', (req, res) => {
  const users = readUsers();
  res.json(users);
});

app.get('/api/users/:id', async (req, res) => {
  const users = readUsers();
  const param = String(req.params.id).trim();
  const u = users.find(x => x.id === param || (x.code && String(x.code).trim() === param));
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(u);
});

// Update user details (e.g. section, designation, name, code)
app.patch('/api/users/:id', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id;
  const users = readUsers();
  const u = users.find(x => x.id === id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (req.body.section !== undefined) {
    const s = req.body.section.trim();
    u.section = (s && s.toLowerCase() !== 'unassigned') ? s : ((u.designation && u.designation.trim()) || 'General');
  }
  if (req.body.name !== undefined) u.name = req.body.name.trim();
  if (req.body.designation !== undefined) u.designation = req.body.designation.trim();
  if (req.body.code !== undefined) u.code = req.body.code.trim();
  writeUsers(users);
  res.json(u);
});

// Delete a single user
app.delete('/api/users/:id', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id;
  const users = readUsers();
  const idx = users.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });

  const [removedUser] = users.splice(idx, 1);
  writeUsers(users);

  // Clean up face images on disk
  if (Array.isArray(removedUser.images)) {
    removedUser.images.forEach(imgRelPath => {
      try {
        const fullPath = path.join(ROOT, imgRelPath.replace(/^\//, ''));
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (err) { /* ignore */ }
    });
  }

  // Clean up attendance records for this user
  try {
    const attendance = readAttendance();
    const filteredAtt = attendance.filter(a => a.userId !== id);
    if (filteredAtt.length !== attendance.length) {
      writeAttendance(filteredAtt);
    }
  } catch (err) { /* ignore */ }

  res.json({ ok: true, deletedId: id, name: removedUser.name });
});

// Bulk delete users
const handleBulkDelete = (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
  const ids = req.body.ids;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'No user IDs provided' });
  }

  const users = readUsers();
  const idSet = new Set(ids.map(String));
  const remainingUsers = [];
  const removedUsers = [];

  users.forEach(u => {
    if (idSet.has(String(u.id))) {
      removedUsers.push(u);
    } else {
      remainingUsers.push(u);
    }
  });

  writeUsers(remainingUsers);

  // Clean up face images on disk
  removedUsers.forEach(u => {
    if (Array.isArray(u.images)) {
      u.images.forEach(imgRelPath => {
        try {
          const fullPath = path.join(ROOT, imgRelPath.replace(/^\//, ''));
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch (err) { /* ignore */ }
      });
    }
  });

  // Clean up attendance records
  try {
    const attendance = readAttendance();
    const filteredAtt = attendance.filter(a => !idSet.has(String(a.userId)));
    if (filteredAtt.length !== attendance.length) {
      writeAttendance(filteredAtt);
    }
  } catch (err) { /* ignore */ }

  res.json({ ok: true, deletedCount: removedUsers.length, ids });
};

app.post('/api/users/delete-bulk', handleBulkDelete);
app.delete('/api/users', handleBulkDelete);


// Mark attendance for a user (called by kiosk after scan)
app.post('/api/attendance/mark', (req, res) => {
  const id = req.body.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const users = readUsers();
  const u = users.find(x => x.id === id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const now = new Date();
  const date = (req.body.date) ? req.body.date : now.toISOString().slice(0,10);
  const attendance = readAttendance();
  let entry = attendance.find(a => a.date === date && a.userId === id);
  if (!entry) {
    entry = {
      userId: id,
      date,
      name: u.name,
      email: u.email,
      designation: u.designation || '',
      code: u.code || '',
      section: (u.section && u.section.trim() && u.section.trim().toLowerCase() !== 'unassigned') ? u.section.trim() : ((u.designation && u.designation.trim()) || 'General'),
      timeIn: now.toISOString(),
      timeOut: null,
      firstSeen: now.toISOString(),
      lastSeen: now.toISOString()
    };
    attendance.push(entry);
  } else {
    entry.lastSeen = now.toISOString();
    if (!entry.timeOut) {
      entry.timeOut = now.toISOString();
    } else if (new Date(now) > new Date(entry.timeOut)) {
      entry.timeOut = now.toISOString();
    }
  }
  writeAttendance(attendance);
  res.json({ ok: true, entry, already: !!entry });
});

// Get attendance report for a date (grouped by section)
app.get('/api/attendance', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const users = readUsers();
  const attendance = readAttendance().filter(a => a.date === date);
  const presentMap = {};
  attendance.forEach(a => { presentMap[a.userId] = a; });
  const sections = {};
  users.forEach(u => {
    const key = (u.section || 'Unassigned').trim() || 'Unassigned';
    if (!sections[key]) sections[key] = { present: [], absent: [] };
    const entry = presentMap[u.id];
    if (entry) {
      sections[key].present.push(Object.assign({}, u, {
        timeIn: entry.timeIn,
        timeOut: entry.timeOut,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        timestamp: entry.lastSeen || entry.timeIn || entry.firstSeen || ''
      }));
    } else {
      sections[key].absent.push(u);
    }
  });
  // sort lists
  Object.keys(sections).forEach(k => {
    sections[k].present.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    sections[k].absent.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  });
  res.json({ date, sections });
});

// Export attendance as CSV or XLSX
app.get('/api/attendance/export', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const type = (req.query.type || 'csv').toLowerCase();
  const users = readUsers();
  const attendance = readAttendance().filter(a => a.date === date);
  const presentMap = {};
  attendance.forEach(a => { presentMap[a.userId] = a; });
  // build rows per section
  const sections = {};
  users.forEach(u => {
    const key = (u.section || 'Unassigned').trim() || 'Unassigned';
    if (!sections[key]) sections[key] = { present: [], absent: [] };
    if (presentMap[u.id]) {
      const entry = presentMap[u.id];
      sections[key].present.push(Object.assign({}, u, { 
        timeIn: entry.timeIn ? new Date(entry.timeIn).toLocaleTimeString() : '', 
        timeOut: entry.timeOut ? new Date(entry.timeOut).toLocaleTimeString() : '' 
      }));
    } else {
      sections[key].absent.push(u);
    }
  });

  if (type === 'csv') {
    const rows = [['Section','Status','No','ID','Name','Email','Time In','Time Out']];
    Object.keys(sections).sort().forEach(sectionName => {
      const s = sections[sectionName];
      let i=1;
      s.present.forEach(u=>{ rows.push([sectionName,'Present',i++,u.id,u.name||'',u.email||'',u.timeIn || '', u.timeOut || '']); });
      i=1;
      s.absent.forEach(u=>{ rows.push([sectionName,'Absent',i++,u.id,u.name||'',u.email||'','','']); });
    });
    const csv = rows.map(r=> r.map(cell => typeof cell === 'string' && (cell.includes(',') || cell.includes('\n')) ? `"${cell.replace(/"/g,'""')}"` : cell).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
    return res.send(csv);
  }

  // XLSX export using exceljs if available
  if (type === 'xlsx') {
    try {
      const Excel = require('exceljs');
      const wb = new Excel.Workbook();
      const ws = wb.addWorksheet('Attendance');
      ws.columns = [
        { header: 'Section', key: 'section', width: 18 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'No', key: 'no', width: 6 },
        { header: 'ID', key: 'id', width: 18 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Designation', key: 'designation', width: 16 },
        { header: 'Code', key: 'code', width: 12 },
        { header: 'Time In', key: 'timeIn', width: 14 },
        { header: 'Time Out', key: 'timeOut', width: 14 }
      ];
      // Header styling
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      let r = 2;
      Object.keys(sections).sort().forEach(sectionName=>{
        const s = sections[sectionName];
        let i = 1;
        s.present.forEach(u=> {
          const row = ws.addRow({ section: sectionName, status: 'Present', no: i++, id: u.id, name: u.name||'', email: u.email||'', designation: u.designation||'', code: u.code||'', timeIn: u.timeIn||'', timeOut: u.timeOut||'' });
          row.getCell('status').font = { color: { argb: 'FF00B050' }, bold: true };
          r++;
        });
        i = 1;
        s.absent.forEach(u=> {
          const row = ws.addRow({ section: sectionName, status: 'Absent', no: i++, id: u.id, name: u.name||'', email: u.email||'', designation: u.designation||'', code: u.code||'', timeIn: u.timeIn||'', timeOut: u.timeOut||'' });
          row.getCell('status').font = { color: { argb: 'FFFF0000' }, bold: true };
          r++;
        });
      });
      // Add borders
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        });
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      return res.status(500).json({ error: 'XLSX export failed: ' + e.message });
    }
    return;
  }

  if (type === 'pdf') {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 30, layout: 'landscape' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.pdf"`);
      doc.pipe(res);
      doc.fontSize(20).font('Helvetica-Bold').text('Attendance Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica').fillColor('#555').text(`Date: ${date}`, { align: 'center' });
      doc.moveDown(1.5);
      
      const colX = [30, 80, 110, 190, 320, 480, 580, 640, 710];
      const headers = ['Status','No','ID','Name','Email','Designation','Code','Time In','Time Out'];

      Object.keys(sections).sort().forEach(sectionName => {
        const s = sections[sectionName];
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#333').text(sectionName, 30, doc.y);
        doc.moveDown(0.5);
        
        // Draw Header
        doc.rect(30, doc.y, 760, 20).fill('#eee');
        let headerY = doc.y + 5;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
        headers.forEach((h, i) => doc.text(h, colX[i], headerY));
        doc.moveDown(1.5);

        const drawRow = (u, idx, isPresent) => {
          if (doc.y > 540) { doc.addPage(); doc.y = 40; }
          let startY = doc.y;
          doc.font('Helvetica-Bold').fillColor(isPresent ? 'green' : 'red').text(isPresent ? 'Present' : 'Absent', colX[0], startY);
          doc.font('Helvetica').fillColor('#000');
          doc.text(String(idx+1), colX[1], startY);
          doc.text(u.id || '', colX[2], startY);
          doc.text(u.name || '', colX[3], startY);
          doc.text(u.email || '', colX[4], startY);
          doc.text(u.designation || '', colX[5], startY);
          doc.text(u.code || '', colX[6], startY);
          doc.text(u.timeIn || '', colX[7], startY);
          doc.text(u.timeOut || '', colX[8], startY);
          doc.moveDown(0.8);
          doc.moveTo(30, doc.y).lineTo(790, doc.y).stroke('#ccc');
          doc.moveDown(0.5);
        };

        s.present.forEach((u,i) => drawRow(u, i, true));
        s.absent.forEach((u,i) => drawRow(u, i, false));
        doc.moveDown(1);
      });
      doc.end();
    } catch (e) {
      return res.status(500).json({ error: 'PDF export failed: ' + e.message });
    }
    return;
  }

  res.status(400).json({ error: 'Unsupported export type' });
});

app.get('/api/users/:id/qr', async (req, res) => {
  const users = readUsers();
  const param = String(req.params.id).trim();
  const u = users.find(x => x.id === param || (x.code && String(x.code).trim() === param));
  if (!u) return res.status(404).json({ error: 'Not found' });
  const host = req.protocol + '://' + req.get('host');
  const url = host + '/api/users/' + u.id;
  try {
    const dataUrl = await qrcode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8
    });
    res.json({ dataUrl, url, id: u.id, code: u.code, name: u.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// HTTP server: redirect to HTTPS for LAN/external, keep as-is only for localhost (camera works there)
const httpApp = express();
httpApp.use((req, res) => {
  const host = req.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal) {
    const httpsUrl = `https://${host}:${HTTPS_PORT}${req.url}`;
    return res.redirect(302, httpsUrl);
  }
  app(req, res);
});
http.createServer(httpApp).listen(PORT, () => {
  console.log(`HTTP  server -> http://localhost:${PORT}  (redirects to HTTPS for LAN)`);
});


// Start HTTPS server with self-signed cert (required for camera on LAN/public IP)
(async () => {
  try {
    const certDir = path.join(ROOT, 'certs');
    const certFile = path.join(certDir, 'cert.pem');
    const keyFile  = path.join(certDir, 'key.pem');

    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

    let sslCert, sslKey;
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      sslCert = fs.readFileSync(certFile, 'utf8');
      sslKey  = fs.readFileSync(keyFile, 'utf8');
      console.log('Loaded existing SSL certificate.');
    } else {
      console.log('Generating self-signed SSL certificate...');
      const attrs = [{ name: 'commonName', value: 'rfid-kiosk' }];
      const pems  = await selfsigned.generate(attrs, {
        keySize: 2048,
        days: 825,
        algorithm: 'sha256',
        extensions: [
          { name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' }
          ]}
        ]
      });
      sslCert = pems.cert;
      sslKey  = pems.private;
      fs.writeFileSync(certFile, sslCert);
      fs.writeFileSync(keyFile, sslKey);
      console.log('Self-signed SSL certificate saved to ./certs/');
    }

    https.createServer({ key: sslKey, cert: sslCert }, app).listen(HTTPS_PORT, () => {
      console.log(`HTTPS server -> https://localhost:${HTTPS_PORT}`);
      console.log(`HTTPS server -> https://10.117.10.10:${HTTPS_PORT}  (LAN)`);
      console.log('NOTE: On first visit, accept the self-signed certificate warning in your browser.');
    });
  } catch (err) {
    console.warn('HTTPS server could not start:', err.message);
  }
})();

