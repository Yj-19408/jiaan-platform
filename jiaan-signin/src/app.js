'use strict';
const express = require('express');
const path = require('node:path');
const { createHmac, createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { createFeishuClient } = require('./feishu');
const { AppError } = require('./errors');
const { PEOPLE, PROJECTS } = require('./constants');
const COOKIE = 'jiaan_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function summarize(records, key, expected) {
  const counts = new Map(expected.map(name => [name, 0]));
  for (const record of records) {
    for (const name of new Set((record[key] || '未填写').split('、').filter(Boolean))) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function createApp({ env = process.env, client = createFeishuClient({ env }), now = Date.now, publicDir = path.join(__dirname, '..', 'public') } = {}) {
  const app = express();
  const failures = new Map();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    if (req.path.startsWith('/api/') || req.path === '/health') res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: env.NODE_ENV === 'production', path: '/api' };
  function adminPassword() {
    if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 12) throw new AppError('后台尚未配置完成，请设置至少 12 个字符的 ADMIN_PASSWORD。', 503);
    return env.ADMIN_PASSWORD;
  }
  function signature(value) { return createHmac('sha256', adminPassword()).update(`jiaan-session-v1:${value}`).digest('base64url'); }
  function clearSession(res) { res.clearCookie(COOKIE, cookieOptions); }
  function authenticated(req) {
    const entry = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
    if (!entry) return false;
    const value = entry.slice(COOKIE.length + 1);
    if (value.length > 512) return false;
    const parts = value.split('.');
    if (parts.length !== 3 || !/^\d{13}$/.test(parts[0]) || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return false;
    const expected = signature(`${parts[0]}.${parts[1]}`);
    if (!timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return false;
    const expires = Number(parts[0]);
    return expires > now() && expires <= now() + SESSION_MS;
  }
  function protect(req, res, next) {
    try {
      adminPassword();
      if (!authenticated(req)) {
        clearSession(res);
        throw new AppError('请先登录后台，登录已失效时请重新登录。', 401);
      }
      next();
    } catch (error) { next(error); }
  }
  function originGuard(req, res, next) {
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) throw new Error('origin');
      } catch { return next(new AppError('请求来源不匹配，请从本站后台页面操作。', 403)); }
    }
    next();
  }
  app.get('/health', (req, res) => res.json({ success: true, status: 'ok' }));
  app.post('/api/sign', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('请填写完整签到信息。', 400);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.replace(/\s/g, '') : '';
    const person = typeof body.person === 'string' ? body.person.trim() : '';
    const project = typeof body.project === 'string' ? body.project.trim() : '';
    if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new AppError('请输入 1 至 40 个字符的姓名。', 400);
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new AppError('请输入正确的 11 位中国大陆手机号码。', 400);
    if (!PEOPLE.includes(person)) throw new AppError('请选择有效的签到人员类别。', 400);
    if (!PROJECTS.includes(project)) throw new AppError('请选择有效的参与项目。', 400);
    if (body.clientToken != null && (typeof body.clientToken !== 'string' || !UUID_V4.test(body.clientToken))) throw new AppError('签到请求编号无效，请刷新页面后重试。', 400);
    const recordId = await client.createRecord({ name, phone, person, project, clientToken: body.clientToken });
    if (typeof recordId !== 'string' || !recordId) throw new AppError('飞书未确认写入成功，请工作人员查询签到结果。', 502);
    res.status(201).json({ success: true, recordId });
  });
  app.post('/api/admin/login', originGuard, (req, res) => {
    const password = adminPassword();
    const key = req.ip;
    const previous = failures.get(key);
    if (previous && previous.until > now() && previous.count >= 10) throw new AppError('登录尝试过于频繁，请 15 分钟后再试。', 429);
    const attempt = typeof req.body?.password === 'string' ? req.body.password : '';
    const correct = timingSafeEqual(createHash('sha256').update(attempt).digest(), createHash('sha256').update(password).digest());
    if (!correct) {
      if (failures.size > 2000) failures.delete(failures.keys().next().value);
      failures.set(key, previous && previous.until > now() ? { ...previous, count: previous.count + 1 } : { count: 1, until: now() + 15 * 60 * 1000 });
      clearSession(res);
      throw new AppError('后台密码错误，请重新输入。', 401);
    }
    failures.delete(key);
    const payload = `${now() + SESSION_MS}.${randomBytes(16).toString('hex')}`;
    res.cookie(COOKIE, `${payload}.${signature(payload)}`, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ success: true, authenticated: true });
  });
  app.post('/api/admin/logout', originGuard, (req, res) => { clearSession(res); res.json({ success: true }); });
  app.get('/api/admin/session', protect, (req, res) => res.json({ success: true, authenticated: true }));
  app.get('/api/admin/connection', protect, async (req, res) => res.json(await client.connection()));
  app.get('/api/count', protect, async (req, res) => {
    const items = await client.getRecords();
    res.json({ success: true, total: items.length });
  });
  app.get('/api/stats', protect, async (req, res) => {
    const items = await client.getRecords();
    res.json({ success: true, total: items.length, projects: summarize(items, 'project', PROJECTS), people: summarize(items, 'person', PEOPLE), updatedAt: new Date(now()).toISOString() });
  });
  app.get('/api/list', protect, async (req, res) => {
    const items = await client.getRecords();
    res.json({ success: true, items, total: items.length });
  });
  app.use('/api', (req, res) => res.status(404).json({ success: false, message: '接口不存在。', error: '接口不存在。' }));
  app.use(express.static(publicDir, { index: 'index.html', etag: true, setHeaders: res => res.set('Cache-Control', 'no-cache') }));
  app.use((req, res) => res.status(404).send('页面不存在。'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let safe = error instanceof AppError ? error : new AppError('服务暂时不可用，请稍后重试。', 500);
    if (error.type === 'entity.parse.failed') safe = new AppError('提交内容格式错误，请刷新页面后重试。', 400);
    if (error.type === 'entity.too.large') safe = new AppError('提交内容过大，请检查填写信息。', 413);
    const output = { success: false, message: safe.message, error: safe.message };
    if (Number.isSafeInteger(safe.code)) output.code = safe.code;
    if (safe.errorType) output.errorType = safe.errorType;
    res.status(safe.status).json(output);
  });
  return app;
}
module.exports = { createApp, summarize };
