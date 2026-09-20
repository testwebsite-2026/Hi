'use strict';
/**
 * Project 77 – registration server.
 * Zero dependencies: plain Node.js (>= 18).
 *
 * Env vars:
 *   PORT            – set automatically by Railway
 *   DATA_DIR        – where registrations.json and settings.json live (default ./data).
 *                     On Railway, mount a Volume and point this at it (e.g. /data)
 *   ADMIN_PASSWORD  – the password for the admin login at /admin (required to use the admin area)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 8 * 1024;
const SESSION_DAYS = 7;
const COOKIE_NAME = 'p77_session';

/* ------------------------------------------------------------------ helpers */

const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* ------------------------------------------------------------ registrations */

fs.mkdirSync(DATA_DIR, { recursive: true });

let registrations = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    registrations = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(registrations)) throw new Error('registrations.json is not an array');
  }
} catch (err) {
  const backup = DATA_FILE + '.corrupt-' + Date.now();
  console.error('Could not read registrations.json, moving it to', backup, '-', err.message);
  try { fs.renameSync(DATA_FILE, backup); } catch (_) { /* ignore */ }
  registrations = [];
}

const persist = () => atomicWrite(DATA_FILE, JSON.stringify(registrations, null, 2));

function nextRef() {
  let max = 0;
  for (const r of registrations) {
    const n = parseInt(String(r.ref || '').replace(/^P77-/, ''), 10);
    if (n > max) max = n;
  }
  return 'P77-' + String(max + 1).padStart(4, '0');
}

/* ---------------------------------------------------------- event settings */

const DEFAULT_EVENT = {
  projectName: 'Project 77',
  title: 'Let Go, Let God',
  date: '2026-09-28',
  startTime: '13:00',
  endTime: '17:00',
  venue: 'Multipurpose Hall',
  verse: 'I do not say to you seven times, but seventy-seven times.',
  verseRef: 'Matthew 18:22',
  tagline: 'Guided by Grace, Driven by Faith',
  contactEmail: 'ccmalangilan@g.batstate-u.edu.ph',
  showBanner: true,
  registrationOpen: true,
  closedMessage: 'Registration is now closed. Thank you for your interest!'
};

function validateEvent(body) {
  const errors = {};
  const d = {};
  const str = (key, max, required) => {
    const v = clean(body[key]);
    if (required && !v) errors[key] = 'This field is required.';
    else if (v.length > max) errors[key] = 'Please keep this under ' + max + ' characters.';
    d[key] = v;
  };
  str('projectName', 60, false);
  str('title', 80, true);
  str('venue', 100, true);
  str('verse', 140, false);
  str('verseRef', 60, false);
  str('tagline', 100, false);
  str('closedMessage', 200, true);

  d.date = clean(body.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || new Date(d.date + 'T00:00:00Z').toISOString().slice(0, 10) !== d.date) {
    errors.date = 'Pick a valid date.';
  }
  for (const key of ['startTime', 'endTime']) {
    d[key] = clean(body[key]);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d[key])) errors[key] = 'Pick a valid time.';
  }
  d.contactEmail = clean(body.contactEmail).toLowerCase();
  if (d.contactEmail && (d.contactEmail.length > 254 || !EMAIL_RE.test(d.contactEmail))) {
    errors.contactEmail = 'Enter a valid email address, or leave it empty.';
  }
  d.showBanner = body.showBanner === true;
  d.registrationOpen = body.registrationOpen === true;
  return { errors, data: d };
}

let eventSettings = Object.assign({}, DEFAULT_EVENT);
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const { errors, data } = validateEvent(Object.assign({}, DEFAULT_EVENT, saved));
    if (Object.keys(errors).length) console.error('settings.json has invalid values, using defaults for:', Object.keys(errors).join(', '));
    else eventSettings = data;
  }
} catch (err) {
  console.error('Could not read settings.json, using defaults:', err.message);
}

const persistSettings = () => atomicWrite(SETTINGS_FILE, JSON.stringify(eventSettings, null, 2));

function fmtDate(iso, withWeekday) {
  const [y, m, d] = iso.split('-').map(Number);
  const opts = { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' };
  if (withWeekday) opts.weekday = 'long';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', opts);
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}

/** Event settings plus the ready-to-display strings the page and certificate use. */
function publicEvent() {
  const e = eventSettings;
  return Object.assign({}, e, {
    dateLong: fmtDate(e.date, true),
    dateShort: fmtDate(e.date, false),
    timeRange: fmtTime(e.startTime) + ' to ' + fmtTime(e.endTime),
    fullTitle: e.projectName ? e.projectName + ': ' + e.title : e.title
  });
}

/* ---------------------------------------------------------- page template */

const INDEX_TEMPLATE = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function keep(html, name, on) {
  const re = new RegExp('<!--IF:' + name + '-->([\\s\\S]*?)<!--/IF:' + name + '-->', 'g');
  return html.replace(re, (m, inner) => (on ? inner : ''));
}

function renderIndex() {
  const ev = publicEvent();

  // "Let Go, Let God" -> two lines, like the poster
  const comma = ev.title.indexOf(',');
  const lines = comma > -1 && comma < ev.title.length - 1
    ? [ev.title.slice(0, comma + 1), ev.title.slice(comma + 1).trim()]
    : [ev.title];
  const longest = Math.max(...lines.map((l) => l.length));
  const titleClass = longest <= 9 ? '' : longest <= 16 ? 'md' : 'sm';

  const vars = {
    fullTitle: esc(ev.fullTitle),
    projectName: esc(ev.projectName),
    titleHtml: lines.map(esc).join('<br>'),
    titleClass,
    dateLong: esc(ev.dateLong),
    dateShort: esc(ev.dateShort),
    timeRange: esc(ev.timeRange),
    venue: esc(ev.venue),
    tagline: esc(ev.tagline),
    contactEmail: esc(ev.contactEmail),
    closedMessage: esc(ev.closedMessage),
    eventJson: JSON.stringify(ev).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  };

  let html = INDEX_TEMPLATE;
  html = keep(html, 'project', !!ev.projectName);
  html = keep(html, 'banner', ev.showBanner);
  html = keep(html, 'open', ev.registrationOpen);
  html = keep(html, 'closed', !ev.registrationOpen);
  html = keep(html, 'tagline', !!ev.tagline);
  html = keep(html, 'contact', !!ev.contactEmail);
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : ''));
}

/* --------------------------------------------------------------- validation */

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'’\-]*$/u;
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];

function validate(body) {
  const errors = {};
  const data = {
    fullName: clean(body.fullName),
    course: clean(body.course),
    yearLevel: clean(body.yearLevel),
    section: clean(body.section),
    contact: clean(body.contact).replace(/[\s\-()]/g, ''),
    email: clean(body.email).toLowerCase(),
    attendance: clean(body.attendance).toLowerCase()
  };

  if (data.fullName.length < 2 || data.fullName.length > 100 || !NAME_RE.test(data.fullName)) {
    errors.fullName = 'Enter your full name (letters only).';
  }
  if (data.course.length < 2 || data.course.length > 100) errors.course = 'Enter your course or program.';
  if (!YEARS.includes(data.yearLevel)) errors.yearLevel = 'Choose your year level.';
  if (data.section.length < 1 || data.section.length > 30) errors.section = 'Enter your section.';
  const m = data.contact.match(/^(?:\+?63|0)(9\d{9})$/);
  if (!m) errors.contact = 'Enter a valid mobile number, e.g. 09123456789.';
  else data.contact = '0' + m[1];
  if (data.email.length > 254 || !EMAIL_RE.test(data.email)) errors.email = 'Enter a valid email address.';
  if (data.attendance !== 'yes' && data.attendance !== 'no') errors.attendance = 'Please confirm whether you will attend.';
  return { errors, data };
}

/* -------------------------------------------------------------- rate limit */

function makeLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(ip);
  }, 5 * 60 * 1000).unref();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(ip, list);
    return list.length > limit;
  };
}
const registerLimited = makeLimiter(12, 60 * 1000);
const loginLimited = makeLimiter(8, 5 * 60 * 1000);

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ------------------------------------------------------------ http helpers */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, headers));
  res.end(body);
}
function sendJson(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
}
const text = (res, status, msg) => send(res, status, msg, { 'Content-Type': 'text/plain; charset=utf-8' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad body');
  return body;
}

function csvCell(v, { keepZero = false } = {}) {
  let s = String(v == null ? '' : v);
  if (keepZero && /^\d+$/.test(s)) return `"=""${s}"""`; // keeps the leading 0 in Excel
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
  return '"' + s.replace(/"/g, '""') + '"';
}

/* ------------------------------------------------------------ admin session */

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const sign = (payload) => crypto.createHmac('sha256', sha('p77-session:' + ADMIN_PASSWORD)).update(payload).digest('hex');

function makeToken() {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return exp + '.' + sign(exp);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const token = readCookie(req, COOKIE_NAME);
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}

function cookieHeader(req, value, maxAge) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return COOKIE_NAME + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

/* --------------------------------------------------------------- admin API */

async function handleAdminApi(req, res, pathname, url) {
  // Anyone can ask whether admin is set up / whether they are signed in.
  if (pathname === '/api/admin/status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, configured: !!ADMIN_PASSWORD, loggedIn: isAdmin(req) });
  }

  // Every state-changing admin request must carry this header. Browsers will not
  // let other websites add it, which blocks cross-site request forgery.
  if (req.method !== 'GET' && req.headers['x-p77-admin'] !== '1') {
    return sendJson(res, 403, { ok: false, message: 'Forbidden.' });
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (!ADMIN_PASSWORD) {
      return sendJson(res, 503, { ok: false, message: 'Admin is not set up yet. Add an ADMIN_PASSWORD variable on the server.' });
    }
    if (loginLimited(clientIp(req))) {
      return sendJson(res, 429, { ok: false, message: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    let body;
    try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, message: 'Bad request.' }); }
    const given = sha(String(body.password || ''));
    if (!crypto.timingSafeEqual(given, sha(ADMIN_PASSWORD))) {
      return sendJson(res, 401, { ok: false, message: 'Wrong password.' });
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeToken(), SESSION_DAYS * 24 * 60 * 60) });
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (!isAdmin(req)) {
    return sendJson(res, 401, { ok: false, message: 'Please sign in.' });
  }

  if (pathname === '/api/admin/event') {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, event: eventSettings, view: publicEvent() });
    }
    if (req.method === 'PUT') {
      let body;
      try { body = await readJson(req); } catch (_) { return sendJson(res, 400, { ok: false, message: 'Bad request.' }); }
      const { errors, data } = validateEvent(body);
      if (Object.keys(errors).length) {
        return sendJson(res, 422, { ok: false, message: 'Please check the highlighted fields.', errors });
      }
      const previous = eventSettings;
      eventSettings = data;
      try {
        persistSettings();
      } catch (err) {
        eventSettings = previous;
        console.error('Failed to save settings:', err);
        return sendJson(res, 500, { ok: false, message: 'Could not save. Please try again.' });
      }
      return sendJson(res, 200, { ok: true, event: eventSettings, view: publicEvent() });
    }
  }

  if (pathname === '/api/admin/registrations') {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, registrations: registrations.slice().reverse() });
    }
    if (req.method === 'DELETE') {
      const ref = clean(url.searchParams.get('ref'));
      const idx = registrations.findIndex((r) => r.ref === ref);
      if (idx === -1) return sendJson(res, 404, { ok: false, message: 'Registration not found.' });
      const [removed] = registrations.splice(idx, 1);
      try {
        persist();
      } catch (err) {
        registrations.splice(idx, 0, removed);
        console.error('Failed to delete registration:', err);
        return sendJson(res, 500, { ok: false, message: 'Could not delete. Please try again.' });
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { ok: false, message: 'Not found.' });
}

function handleCsv(req, res) {
  if (!isAdmin(req)) {
    return send(res, 302, '', { Location: '/admin' });
  }
  const head = ['Reference', 'Submitted (Manila time)', 'Full name', 'Course/Program', 'Year level', 'Section', 'Contact number', 'Email', 'Attending'];
  const rows = registrations.map((r) => [
    csvCell(r.ref),
    csvCell(new Date(r.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })),
    csvCell(r.fullName),
    csvCell(r.course),
    csvCell(r.yearLevel),
    csvCell(r.section),
    csvCell(r.contact, { keepZero: true }),
    csvCell(r.email),
    csvCell(r.attendance === 'yes' ? 'Yes' : 'No')
  ].join(','));
  const csv = '\uFEFF' + [head.map((h) => csvCell(h)).join(',')].concat(rows).join('\r\n');
  return send(res, 200, csv, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="project77-registrations.csv"',
    'Cache-Control': 'no-store'
  });
}

/* ------------------------------------------------------- registration API */

async function handleRegister(req, res) {
  if (registerLimited(clientIp(req))) {
    return sendJson(res, 429, { ok: false, message: 'Too many attempts. Please wait a minute and try again.' });
  }
  if (!eventSettings.registrationOpen) {
    return sendJson(res, 403, { ok: false, message: eventSettings.closedMessage });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, { ok: false, message: 'Something was wrong with the form data. Please try again.' });
  }

  // Honeypot: real people never fill this hidden field. Pretend success.
  if (body.website) {
    return sendJson(res, 200, { ok: true, registration: { ref: 'P77-0000', fullName: clean(body.fullName), createdAt: new Date().toISOString(), attendance: 'yes' } });
  }

  const { errors, data } = validate(body);
  if (Object.keys(errors).length) {
    return sendJson(res, 422, { ok: false, message: 'Please check the highlighted fields.', errors });
  }

  const existing = registrations.find((r) => r.email === data.email);
  if (existing) {
    if (existing.fullName.toLowerCase() === data.fullName.toLowerCase()) {
      // Same person submitting again (e.g. lost their certificate) – return the original record.
      return sendJson(res, 200, {
        ok: true,
        existing: true,
        registration: { ref: existing.ref, fullName: existing.fullName, createdAt: existing.createdAt, attendance: existing.attendance }
      });
    }
    return sendJson(res, 409, {
      ok: false,
      message: 'Please check the highlighted fields.',
      errors: { email: 'This email is already registered under a different name.' }
    });
  }

  const record = Object.assign({ ref: nextRef(), createdAt: new Date().toISOString() }, data);
  registrations.push(record);
  try {
    persist();
  } catch (err) {
    registrations.pop();
    console.error('Failed to save registration:', err);
    return sendJson(res, 500, { ok: false, message: 'We could not save your registration. Please try again.' });
  }

  return sendJson(res, 201, {
    ok: true,
    registration: { ref: record.ref, fullName: record.fullName, createdAt: record.createdAt, attendance: record.attendance }
  });
}

/* ------------------------------------------------------------------ static */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (_) {
    return text(res, 400, 'Bad request');
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return text(res, 403, 'Forbidden');
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return text(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(
      200,
      Object.assign({}, SECURITY_HEADERS, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache'
      })
    );
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/healthz') return text(res, 200, 'ok');

    if (pathname === '/api/register') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed' });
      return await handleRegister(req, res);
    }

    if (pathname.startsWith('/api/admin/')) return await handleAdminApi(req, res, pathname, url);

    if (pathname === '/admin/export.csv') return handleCsv(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed');

    if (pathname === '/' || pathname === '/index.html') {
      return send(res, 200, req.method === 'HEAD' ? '' : renderIndex(), {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
    }
    if (pathname === '/admin' || pathname === '/admin/') return serveStatic(req, res, '/admin.html');

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, message: 'Server error. Please try again.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Project 77 registration running on port ${PORT}`);
  console.log(`Data folder: ${DATA_DIR}`);
  console.log(ADMIN_PASSWORD ? 'Admin login: enabled at /admin' : 'Admin login: DISABLED (set ADMIN_PASSWORD to enable)');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(sig + ' received, shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
