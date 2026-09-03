/**
 * 认证与操作归属（原型：用户名密码 + 持久化会话令牌）
 * 真实环境替换为：行内 LDAP/SSO 单点登录，本模块仅保留"操作归属"落库逻辑
 */
const crypto = require('crypto');

const AUTH_DDL = [
  'CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, display_name TEXT, password_hash TEXT, salt TEXT, created_at TEXT)',
  'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT, created_at TEXT)',
];

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** 建 auth 相关表，并为旧库补列（CREATE IF NOT EXISTS 不会改已存在的表） */
function ensureAuthSchema(db) {
  for (const ddl of AUTH_DDL) db.prepare(ddl).run();
  const caseCols = db.prepare('PRAGMA table_info(cases)').all().map(c => c.name);
  if (!caseCols.includes('created_by')) {
    db.prepare("ALTER TABLE cases ADD COLUMN created_by TEXT DEFAULT ''").run();
  }
  const logCols = db.prepare('PRAGMA table_info(query_log)').all().map(c => c.name);
  if (!logCols.includes('user_name')) {
    db.prepare("ALTER TABLE query_log ADD COLUMN user_name TEXT DEFAULT ''").run();
  }
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function register(db, { username, password, display_name }) {
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(name)) return { ok: false, message: '用户名限 2-32 位小写字母/数字/下划线' };
  if (String(password || '').length < 6) return { ok: false, message: '密码至少 6 位' };
  const exists = db.prepare('SELECT username FROM users WHERE username=?').get(name);
  if (exists) return { ok: false, message: `用户 ${name} 已存在，请直接登录` };
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(
    name, String(display_name || '').trim() || name, hash(password, salt), salt, new Date().toISOString());
  return createSession(db, name);
}

function login(db, { username, password }) {
  const name = String(username || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(name);
  if (!u || hash(password, u.salt) !== u.password_hash) return { ok: false, message: '用户名或密码错误' };
  return createSession(db, name);
}

function createSession(db, username) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, username, new Date().toISOString());
  const u = db.prepare('SELECT username, display_name FROM users WHERE username=?').get(username);
  return { ok: true, token, user: u };
}

function logout(db, token) {
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

/** 会话校验：过期/无效返回 null */
function resolveUser(db, token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s || Date.now() - new Date(s.created_at).getTime() > TOKEN_TTL_MS) {
    if (s) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return db.prepare('SELECT username, display_name FROM users WHERE username=?').get(s.username) || null;
}

/** Express 中间件：要求登录，并将当前用户挂到 req.user */
function requireAuth(db) {
  return (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = resolveUser(db, token);
    if (!user) return res.status(401).json({ error: '未登录或会话已过期，请重新登录', needLogin: true });
    req.user = user;
    req.token = token;
    next();
  };
}

module.exports = { ensureAuthSchema, register, login, logout, resolveUser, requireAuth };
