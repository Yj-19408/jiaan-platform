'use strict';
const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');
const BASE = 'https://open.feishu.cn/open-apis';
const REQUIRED = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_APP_TOKEN', 'FEISHU_TABLE_ID'];
const TOKEN_REJECTED = new Set([99991663, 99991665]);
const ALLOWED_TYPES = { '姓名': [1], '联系电话': [1, 13], '签到人员': [1, 3, 4], '参与项目': [1, 3, 4], '签到时间': [5] };

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const richText = value.every(item => item && typeof item === 'object' && typeof item.text === 'string');
    return value.map(textValue).filter(Boolean).join(richText ? '' : '、');
  }
  if (typeof value === 'object' && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && typeof value.name === 'string') return value.name;
  return '';
}

function apiError(code, status) {
  let message = '飞书接口调用失败，请在后台检查应用权限、表格授权和字段设置。';
  if (TOKEN_REJECTED.has(code)) message = '飞书访问凭证被拒绝，请检查应用配置后重试。';
  else if ([99991672, 99991676, 99991679, 91403].includes(code) || status === 403) message = '飞书应用没有访问权限，请检查应用是否可以访问此表格。';
  else if ([1254045, 1254015, 1254063, 1254072].includes(code)) message = '飞书表格字段或字段类型不匹配，请按部署说明检查四个签到字段。';
  else if ([1254290, 99991400].includes(code) || status === 429) message = '飞书请求过于频繁，请稍后重试。';
  else if (code === 1254291) message = '飞书表格正在处理其他写入，请稍后重试。';
  else if ([1254040, 1254041, 1254042, 1254043, 1254044].includes(code) || status === 404) message = '未找到飞书表格，请检查 app_token、table_id 和应用的表格访问权限。';
  if (Number.isSafeInteger(code)) message += `（飞书错误码 ${code}）`;
  return new AppError(message, status === 429 ? 503 : 502, code);
}

function createFeishuClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let token = null;
  let tokenPromise = null;
  let schema = null;
  let schemaPromise = null;
  function config() {
    const missing = REQUIRED.filter(key => typeof env[key] !== 'string' || !env[key].trim());
    if (missing.length) throw new AppError(`服务尚未配置完成，请填写环境变量：${missing.join('、')}。`, 503);
    return Object.fromEntries(REQUIRED.map(key => [key, env[key].trim()]));
  }
  async function request(url, options = {}, isWrite = false) {
    let response;
    let data;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      data = await response.json();
    } catch {
      const error = new AppError(isWrite
        ? '签到提交结果尚未确认，请先请工作人员在飞书表格或后台查询是否已签到，避免重复提交。'
        : '暂时无法连接飞书，请稍后重试或检查网络。', 502);
      if (isWrite) error.errorType = 'WRITE_UNCERTAIN';
      throw error;
    }
    if (!response.ok || !data || data.code !== 0) throw apiError(Number.isSafeInteger(data?.code) && data.code !== 0 ? data.code : undefined, response.status);
    return data.data ?? data;
  }
  async function getTenantToken() {
    if (token && token.expiresAt > now()) return token.value;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const settings = config();
      const result = await request(`${BASE}/auth/v3/tenant_access_token/internal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: settings.FEISHU_APP_ID, app_secret: settings.FEISHU_APP_SECRET })
      });
      if (typeof result.tenant_access_token !== 'string' || !result.tenant_access_token || !Number.isFinite(result.expire) || result.expire <= 0) {
        throw new AppError('飞书返回的访问凭证无效，请检查应用配置。');
      }
      token = { value: result.tenant_access_token, expiresAt: now() + Math.max(0, result.expire - 60) * 1000 };
      return token.value;
    })();
    try { return await tokenPromise; } finally { tokenPromise = null; }
  }
  function tableUrl() {
    const settings = config();
    return `${BASE}/bitable/v1/apps/${encodeURIComponent(settings.FEISHU_APP_TOKEN)}/tables/${encodeURIComponent(settings.FEISHU_TABLE_ID)}`;
  }
  async function authorized(url, options = {}, isWrite = false) {
    let usedToken = await getTenantToken();
    const perform = () => request(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${usedToken}` } }, isWrite);
    try { return await perform(); } catch (error) {
      if (!TOKEN_REJECTED.has(error.code)) throw error;
      if (token?.value === usedToken) token = null;
      usedToken = await getTenantToken();
      return perform();
    }
  }
  async function collectPages(resource, pageSize) {
    const all = [];
    const seenPages = new Set();
    let pageToken = '';
    while (true) {
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) query.set('page_token', pageToken);
      const result = await authorized(`${tableUrl()}/${resource}?${query}`);
      if (!Array.isArray(result.items) || typeof result.has_more !== 'boolean') throw new AppError('飞书分页数据格式异常，暂时无法读取完整名单。');
      all.push(...result.items);
      if (!result.has_more) return all;
      if (typeof result.page_token !== 'string' || !result.page_token || seenPages.has(result.page_token)) throw new AppError('飞书返回重复或缺失的分页标记，无法保证统计完整，请稍后重试。');
      seenPages.add(result.page_token);
      pageToken = result.page_token;
    }
  }
  async function getSchema(force = false) {
    if (!force && schema && schema.expiresAt > now()) return schema.fields;
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      const fields = await collectPages('fields', 100);
      const byName = new Map(fields.map(field => [field.field_name, field]));
      for (const [name, types] of Object.entries(ALLOWED_TYPES)) {
        const field = byName.get(name);
        if (!field && name === '签到时间') continue;
        if (!field) throw new AppError(`飞书表格缺少“${name}”字段，请核对现有表格的字段名称。`, 503);
        if (!types.includes(field.type)) {
          const suggestion = name === '签到时间' ? '日期' : name === '联系电话' ? '文本或电话号码' : name === '姓名' ? '文本' : '文本、单选或多选';
          throw new AppError(`飞书“${name}”字段类型不匹配，请改为${suggestion}类型${field.type === 11 ? '；飞书“人员”字段不能接收签到身份字符串' : ''}。`, 503);
        }
      }
      schema = { fields: byName, expiresAt: now() + 60000 };
      return byName;
    })();
    try { return await schemaPromise; } finally { schemaPromise = null; }
  }
  async function createRecord(input) {
    const fields = await getSchema();
    const values = { '姓名': input.name, '联系电话': input.phone, '签到人员': input.person, '参与项目': input.project };
    for (const name of ['签到人员', '参与项目']) {
      const field = fields.get(name);
      const options = field.property?.options;
      if ([3, 4].includes(field.type) && Array.isArray(options) && !options.some(option => option.name === values[name])) {
        throw new AppError(`飞书“${name}”的选项中没有“${values[name]}”，请先在表格中添加该选项或改用文本字段。`, 503);
      }
      if (field.type === 4) values[name] = [values[name]];
    }
    if (fields.has('签到时间')) values['签到时间'] = now();
    const writeUrl = `${tableUrl()}/records?client_token=${input.clientToken || randomUUID()}`;
    const options = { method: 'POST', body: JSON.stringify({ fields: values }) };
    let result;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { result = await authorized(writeUrl, options, true); break; }
      catch (error) {
        // 只重试飞书明确返回的写入冲突；网络结果未知不自动重试。
        if (error.code !== 1254291 || attempt === 3) throw error;
        await sleep([300, 900, 1800][attempt]);
      }
    }
    if (typeof result.record?.record_id !== 'string' || !result.record.record_id) {
      const error = new AppError('飞书未返回有效签到记录编号，请请工作人员查询是否已写入，避免重复提交。');
      error.errorType = 'WRITE_UNCERTAIN';
      throw error;
    }
    return result.record.record_id;
  }
  async function getRecords() {
    await getSchema();
    const records = await collectPages('records', 500);
    const ids = new Set();
    const normalized = records.map(record => {
      if (!record || typeof record.record_id !== 'string' || !record.record_id || ids.has(record.record_id)) throw new AppError('飞书名单出现无效或重复记录，无法保证统计完整，请稍后重试。');
      ids.add(record.record_id);
      const field = record.fields || {};
      const timestamp = Number(field['签到时间']);
      return { id: record.record_id, name: textValue(field['姓名']), phone: textValue(field['联系电话']), person: textValue(field['签到人员']), project: textValue(field['参与项目']), time: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null };
    });
    return normalized.sort((a, b) => (b.time || 0) - (a.time || 0));
  }
  async function connection() {
    const fields = await getSchema(true);
    return { success: true, connected: true, fields: [...fields.values()].filter(field => Object.hasOwn(ALLOWED_TYPES, field.field_name)).map(field => ({ name: field.field_name, type: field.type })), hasSignTime: fields.has('签到时间'), message: '飞书连接和必需字段检查通过。' };
  }
  return { getTenantToken, createRecord, getRecords, connection, config };
}
module.exports = { createFeishuClient, textValue };
