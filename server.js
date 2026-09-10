const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!APP_PASSWORD || !SESSION_SECRET) {
  console.error('APP_PASSWORD, SESSION_SECRET 환경변수가 필요합니다.');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'defects.json');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const COOKIE_NAME = 'cv_auth';
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_IMAGES = 5;
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// ---------- 데이터 저장 (JSON 파일, 순차 저장 큐) ----------
let defects = [];
try {
  defects = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) {
  defects = [];
}

let saveChain = Promise.resolve();
function persist() {
  saveChain = saveChain.then(() => new Promise((resolve) => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(defects, null, 2), (err) => {
      if (err) { console.error('저장 실패', err); return resolve(); }
      fs.rename(tmp, DB_FILE, (err2) => {
        if (err2) console.error('저장 교체 실패', err2);
        resolve();
      });
    });
  }));
  return saveChain;
}

// ---------- 인증 ----------
function hmac(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function makeToken() {
  const exp = String(Date.now() + COOKIE_MAX_AGE_MS);
  return `${exp}.${hmac(exp)}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = hmac(payload);
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(macBuf, expBuf)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() < exp;
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function isAuthed(req) {
  return verifyToken(req.cookies && req.cookies[COOKIE_NAME]);
}

// ---------- 앱 ----------
const app = express();
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!safeEqual(password, APP_PASSWORD)) {
    return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  }
  res.cookie(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: COOKIE_MAX_AGE_MS,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ---------- 인증 필요 구간 ----------
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요합니다.' });
  return res.redirect('/login');
}
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});
app.get('/edit', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'edit.html'));
});

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

app.get('/uploads/:id/:filename', (req, res) => {
  const { id, filename } = req.params;
  if (!SAFE_ID.test(id) || !SAFE_FILENAME.test(filename)) return res.sendStatus(400);
  const filePath = path.join(UPLOADS_DIR, id, filename);
  res.sendFile(filePath, (err) => {
    if (err) res.sendStatus(404);
  });
});

// ---------- 이미지 업로드 (용량 제한 없음, 디스크로 스트리밍) ----------
function extFor(file) {
  if (MIME_EXT[file.mimetype]) return MIME_EXT[file.mimetype];
  const orig = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(orig) ? orig : 'img';
}

function makeUpload(getId) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const id = getId(req);
        const dir = path.join(UPLOADS_DIR, id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extFor(file)}`;
        cb(null, name);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype || !file.mimetype.startsWith('image/')) {
        return cb(new Error('IMAGE_ONLY'));
      }
      cb(null, true);
    },
    limits: { files: MAX_IMAGES },
  });
}

function assignNewId(req, res, next) {
  req.newId = crypto.randomUUID();
  next();
}

function handleUploadErrors(err, req, res, next) {
  if (err) {
    const msg = err.message === 'IMAGE_ONLY' ? '이미지 파일만 업로드할 수 있습니다.'
      : err.code === 'LIMIT_FILE_COUNT' ? `사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`
      : '업로드 중 오류가 발생했습니다.';
    return res.status(400).json({ error: msg });
  }
  next();
}

function removeFiles(id, filenames) {
  for (const name of filenames) {
    if (!SAFE_FILENAME.test(name)) continue;
    fs.unlink(path.join(UPLOADS_DIR, id, name), () => {});
  }
}

// ---------- API ----------
app.get('/api/defects', (req, res) => {
  const sorted = defects.filter((d) => !d.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(sorted);
});

app.get('/api/defects/:id', (req, res) => {
  const item = defects.find((d) => d.id === req.params.id);
  if (!item) return res.sendStatus(404);
  res.json(item);
});

app.post('/api/defects', assignNewId, makeUpload((req) => req.newId).array('images', MAX_IMAGES), handleUploadErrors, (req, res) => {
  const location = (req.body.location || '').trim();
  const content = (req.body.content || '').trim();
  if (!location || !content) {
    removeFiles(req.newId, (req.files || []).map((f) => f.filename));
    return res.status(400).json({ error: '하자 위치와 하자 내용을 입력해 주세요.' });
  }
  const now = Date.now();
  const item = {
    id: req.newId,
    location,
    content,
    images: (req.files || []).map((f) => f.filename),
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  defects.push(item);
  persist();
  broadcast({ type: 'upsert', defect: item });
  res.status(201).json(item);
});

app.put('/api/defects/:id', (req, res, next) => {
  const item = defects.find((d) => d.id === req.params.id);
  if (!item) return res.sendStatus(404);
  req.existingItem = item;
  next();
}, makeUpload((req) => req.params.id).array('images', MAX_IMAGES), handleUploadErrors, (req, res) => {
  const item = req.existingItem;
  const location = (req.body.location || '').trim();
  const content = (req.body.content || '').trim();
  let keep = [];
  try { keep = JSON.parse(req.body.keepImages || '[]'); } catch (e) { keep = []; }
  keep = keep.filter((name) => item.images.includes(name));

  const newFiles = (req.files || []).map((f) => f.filename);
  if (!location || !content || keep.length + newFiles.length > MAX_IMAGES) {
    removeFiles(req.params.id, newFiles);
    if (!location || !content) return res.status(400).json({ error: '하자 위치와 하자 내용을 입력해 주세요.' });
    return res.status(400).json({ error: `사진은 최대 ${MAX_IMAGES}장까지 가능합니다.` });
  }

  const removed = item.images.filter((name) => !keep.includes(name));
  removeFiles(req.params.id, removed);

  item.location = location;
  item.content = content;
  item.images = [...keep, ...newFiles];
  item.updatedAt = Date.now();
  persist();
  broadcast({ type: 'upsert', defect: item });
  res.json(item);
});

app.delete('/api/defects/:id', (req, res) => {
  const item = defects.find((d) => d.id === req.params.id);
  if (!item) return res.sendStatus(404);
  item.deleted = true;
  item.updatedAt = Date.now();
  persist();
  broadcast({ type: 'upsert', defect: item });
  res.json({ ok: true });
});

// ---------- 실시간 (WebSocket) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const cookies = parseCookies(req.headers.cookie);
  if (!verifyToken(cookies[COOKIE_NAME])) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
server.on('close', () => clearInterval(heartbeat));

function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
}

server.listen(PORT, () => {
  console.log(`punchlist listening on :${PORT}`);
});
