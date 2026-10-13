'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createFeishuClient, textValue } = require('../src/feishu');
const { createApp } = require('../src/app');
const ENV = { FEISHU_APP_ID: 'test-app', FEISHU_APP_SECRET: 'never-echo-this-secret', FEISHU_APP_TOKEN: 'test-table-app', FEISHU_TABLE_ID: 'test-table', ADMIN_PASSWORD: 'a-test-password-123456' };
const NOW = 1730000000000;
const INPUT = { name: '张三', phone: '13812345678', person: '社区居民', project: '就业咨询' };
const UUID = 'ac7e11d0-2222-4333-8444-abcdef123456';
const tokenResponse = { code: 0, tenant_access_token: 'mock-token', expire: 7200 };
const schema = [
  { field_name: '姓名', type: 1 }, { field_name: '联系电话', type: 13 },
  { field_name: '签到人员', type: 3, property: { options: [{ name: '社区居民' }] } },
  { field_name: '参与项目', type: 4, property: { options: [{ name: '就业咨询' }] } },
  { field_name: '签到时间', type: 5 }, { field_name: '备注', type: 1 }
];
const fieldsResponse = { code: 0, data: { items: schema, has_more: false } };
function transport(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (!responses.length) throw new Error('Unexpected upstream call');
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, options);
    const body = next.body ?? next;
    return { ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300, status: next.status ?? 200, json: async () => body };
  };
  return { fetchImpl, calls };
}
function clientFor(responses, extra = {}) {
  const mock = transport(responses);
  return { client: createFeishuClient({ env: ENV, fetchImpl: mock.fetchImpl, now: () => NOW, ...extra }), ...mock };
}
async function running(t, options) {
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, settings = {}) => fetch(base + route, settings);
  return { request, base };
}
const jsonPost = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function login(request) {
  const response = await request('/api/admin/login', jsonPost({ password: ENV.ADMIN_PASSWORD }));
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('tenant token caches, shares simultaneous refresh, and refreshes 60 seconds before expiry', async () => {
  let clock = NOW;
  const mock = clientFor([tokenResponse, { ...tokenResponse, tenant_access_token: 'second' }], { now: () => clock });
  assert.deepEqual(await Promise.all([mock.client.getTenantToken(), mock.client.getTenantToken()]), ['mock-token', 'mock-token']);
  assert.equal(mock.calls.length, 1);
  clock += 7139 * 1000;
  assert.equal(await mock.client.getTenantToken(), 'mock-token');
  clock += 1000;
  assert.equal(await mock.client.getTenantToken(), 'second');
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), { app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET });
});

test('record creation verifies schema, encodes select/multiselect/date, and preserves UUID idempotency', async () => {
  const mock = clientFor([tokenResponse, fieldsResponse, { code: 0, data: { record: { record_id: 'rec123' } } }]);
  assert.equal(await mock.client.createRecord({ ...INPUT, clientToken: UUID }), 'rec123');
  assert.match(mock.calls[1].url, /fields\?page_size=100$/);
  assert.match(mock.calls[2].url, new RegExp(`client_token=${UUID}$`));
  assert.deepEqual(JSON.parse(mock.calls[2].options.body).fields, { '姓名': '张三', '联系电话': INPUT.phone, '签到人员': '社区居民', '参与项目': ['就业咨询'], '签到时间': NOW });
  assert.equal(mock.calls[2].options.headers.Authorization, 'Bearer mock-token');
  assert.ok(mock.calls[2].options.signal instanceof AbortSignal);
});

test('date is optional and text columns accept strings', async () => {
  const textSchema = schema.filter(field => !['签到时间', '备注'].includes(field.field_name)).map(field => ({ ...field, type: 1 }));
  const mock = clientFor([tokenResponse, { code: 0, data: { items: textSchema, has_more: false } }, { code: 0, data: { record: { record_id: 'rec-text' } } }]);
  await mock.client.createRecord(INPUT);
  const fields = JSON.parse(mock.calls[2].options.body).fields;
  assert.equal(fields['参与项目'], INPUT.project);
  assert.equal(Object.hasOwn(fields, '签到时间'), false);
});

test('unsupported member column, missing field and unavailable select option give actionable errors', async () => {
  const member = schema.map(field => field.field_name === '签到人员' ? { ...field, type: 11 } : field);
  const one = clientFor([tokenResponse, { code: 0, data: { items: member, has_more: false } }]);
  await assert.rejects(one.client.createRecord(INPUT), /人员.*字符串/);
  assert.equal(one.calls.length, 2);
  const two = clientFor([tokenResponse, { code: 0, data: { items: schema.filter(field => field.field_name !== '姓名'), has_more: false } }]);
  await assert.rejects(two.client.createRecord(INPUT), /缺少“姓名”/);
  const three = clientFor([tokenResponse, fieldsResponse]);
  await assert.rejects(three.client.createRecord({ ...INPUT, person: '月嫂' }), /添加该选项/);
  assert.equal(three.calls.length, 2);
});

test('only explicit tenant-token rejection refreshes once and same write UUID is retained', async () => {
  const mock = clientFor([tokenResponse, fieldsResponse, { code: 99991663, msg: ENV.FEISHU_APP_SECRET }, { ...tokenResponse, tenant_access_token: 'new-token' }, { code: 0, data: { record: { record_id: 'rec-new' } } }]);
  await mock.client.createRecord({ ...INPUT, clientToken: UUID });
  assert.equal(mock.calls.length, 5);
  assert.equal(mock.calls[2].url, mock.calls[4].url);
  assert.equal(mock.calls[4].options.headers.Authorization, 'Bearer new-token');
  const forbidden = clientFor([tokenResponse, fieldsResponse, { status: 403, body: { code: 99991676, msg: ENV.FEISHU_APP_SECRET } }]);
  await assert.rejects(forbidden.client.createRecord(INPUT), error => error.code === 99991676 && !error.message.includes(ENV.FEISHU_APP_SECRET));
  assert.equal(forbidden.calls.length, 3);
});

test('network uncertainty on writes does not retry, and success requires a record ID', async () => {
  const mock = clientFor([tokenResponse, fieldsResponse, new Error('network')]);
  await assert.rejects(mock.client.createRecord(INPUT), error => error.errorType === 'WRITE_UNCERTAIN' && /避免重复/.test(error.message));
  assert.equal(mock.calls.length, 3);
  const missingId = clientFor([tokenResponse, fieldsResponse, { code: 0, data: {} }]);
  await assert.rejects(missingId.client.createRecord(INPUT), error => error.errorType === 'WRITE_UNCERTAIN');
});

test('explicit table write conflict retries with the same idempotency UUID and stops after bounded attempts', async () => {
  const delays = [];
  const mock = clientFor([tokenResponse, fieldsResponse, {code:1254291}, {code:1254291}, {code:0,data:{record:{record_id:'rec-retry'}}}], {sleep:async ms => delays.push(ms)});
  assert.equal(await mock.client.createRecord({...INPUT,clientToken:UUID}), 'rec-retry');
  assert.deepEqual(delays,[300,900]);
  assert.equal(new Set(mock.calls.slice(2).map(call => call.url)).size,1);
  assert.match(mock.calls[2].url, new RegExp(`client_token=${UUID}$`));
  const stop = clientFor([tokenResponse, fieldsResponse, ...Array.from({length:4},() => ({code:1254291}))], {sleep:async () => {}});
  await assert.rejects(stop.client.createRecord({...INPUT,clientToken:UUID}), error => error.code === 1254291);
  assert.equal(stop.calls.length,6);
});

test('HTTP failure, invalid JSON, and nonzero business code cannot become success', async () => {
  const badHttp = clientFor([{ status: 500, body: { code: 0, tenant_access_token: 'bad', expire: 7200 } }]);
  await assert.rejects(badHttp.client.getTenantToken());
  const badBusiness = clientFor([{ code: 99991401, msg: 'private detail' }]);
  await assert.rejects(badBusiness.client.getTenantToken(), error => error.code === 99991401 && !error.message.includes('private detail'));
  const badJson = clientFor([() => ({ ok: true, status: 200, json: async () => { throw new Error('Invalid JSON'); } })]);
  await assert.rejects(badJson.client.getTenantToken(), /无法连接飞书/);
});

test('all record pages including more than 100 entries merge with rich text and newest first', async () => {
  const first = Array.from({ length: 500 }, (_, index) => ({ record_id: `rec-${index}`, fields: { '姓名': [{ text: `姓名${index}` }], '联系电话': INPUT.phone, '签到人员': INPUT.person, '参与项目': INPUT.project, '签到时间': NOW + index } }));
  const second = Array.from({ length: 101 }, (_, index) => ({ record_id: `rec-next-${index}`, fields: { '姓名': '后页', '参与项目': ['就业咨询', '其他'], '签到时间': NOW + 500 + index } }));
  const mock = clientFor([tokenResponse, fieldsResponse, { code: 0, data: { items: first, has_more: true, page_token: 'next & /' } }, { code: 0, data: { items: second, has_more: false } }]);
  const records = await mock.client.getRecords();
  assert.equal(records.length, 601);
  assert.equal(records[0].id, 'rec-next-100');
  assert.equal(records[600].name, '姓名0');
  assert.equal(records[0].project, '就业咨询、其他');
  assert.match(mock.calls[2].url, /page_size=500$/);
  assert.equal(new URL(mock.calls[3].url).searchParams.get('page_token'), 'next & /');
});

test('field pages also merge and repeated/missing page tokens fail explicitly', async () => {
  const fieldsPaged = clientFor([tokenResponse, { code: 0, data: { items: schema.slice(0, 2), has_more: true, page_token: 'field-next' } }, { code: 0, data: { items: schema.slice(2), has_more: false } }]);
  assert.equal((await fieldsPaged.client.connection()).connected, true);
  const repeated = clientFor([tokenResponse, fieldsResponse, { code: 0, data: { items: [], has_more: true, page_token: 'same' } }, { code: 0, data: { items: [], has_more: true, page_token: 'same' } }]);
  await assert.rejects(repeated.client.getRecords(), /重复或缺失/);
  const missing = clientFor([tokenResponse, fieldsResponse, { code: 0, data: { items: [], has_more: true } }]);
  await assert.rejects(missing.client.getRecords(), /重复或缺失/);
});

test('configuration failure stops before network and normalizes value formats', async () => {
  const mock = clientFor([], { env: {} });
  await assert.rejects(mock.client.getTenantToken(), /FEISHU_APP_ID/);
  assert.equal(mock.calls.length, 0);
  assert.equal(textValue([{ text: '张' }, { text: '三' }]), '张三');
  assert.equal(textValue({ name: '就业咨询' }), '就业咨询');
  assert.equal(textValue(null), '');
});

test('protected endpoints require login, authenticated lists return every item and counts are complete', async t => {
  const records = Array.from({ length: 601 }, (_, index) => ({ id: `id${index}`, name: '张三', phone: INPUT.phone, person: INPUT.person, project: index < 500 ? INPUT.project : '其他', time: NOW }));
  const { request } = await running(t, { env: ENV, client: { getRecords: async () => records, connection: async () => ({ success: true, connected: true }) }, now: () => NOW });
  for (const endpoint of ['/api/count', '/api/stats', '/api/list', '/api/admin/session', '/api/admin/connection']) assert.equal((await request(endpoint)).status, 401);
  const cookie = await login(request);
  const headers = { Cookie: cookie };
  assert.deepEqual(await (await request('/api/count', { headers })).json(), { success: true, total: 601 });
  const stats = await (await request('/api/stats', { headers })).json();
  assert.equal(stats.total, 601);
  assert.equal(stats.projects.find(item => item.name === '就业咨询').count, 500);
  assert.equal(stats.projects.find(item => item.name === '其他').count, 101);
  assert.equal(stats.people.find(item => item.name === '社区居民').count, 601);
  const list = await (await request('/api/list?page=2&pageSize=1', { headers })).json();
  assert.equal(list.items.length, 601);
  assert.equal(list.total, 601);
  assert.equal((await request('/api/admin/session', { headers })).status, 200);
  assert.equal((await request('/api/admin/connection', { headers })).status, 200);
});

test('cookie is signed, HttpOnly, Strict and Secure in production; expiry and tampering deny access', async t => {
  let clock = NOW;
  const { request } = await running(t, { env: { ...ENV, NODE_ENV: 'production' }, client: {}, now: () => clock });
  const response = await request('/api/admin/login', jsonPost({ password: ENV.ADMIN_PASSWORD }));
  const header = response.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  const cookie = header.split(';')[0];
  const badCookie = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
  assert.equal((await request('/api/admin/session', { headers: { Cookie: badCookie } })).status, 401);
  clock += 12 * 60 * 60 * 1000;
  assert.equal((await request('/api/admin/session', { headers: { Cookie: cookie } })).status, 401);
  const logout = await request('/api/admin/logout', { method: 'POST' });
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
});

test('incorrect passwords, short configuration, and cross-origin login are rejected', async t => {
  const { request } = await running(t, { env: ENV, client: {}, now: () => NOW });
  for (let count = 0; count < 10; count++) assert.equal((await request('/api/admin/login', jsonPost({ password: 'wrong' }))).status, 401);
  assert.equal((await request('/api/admin/login', jsonPost({ password: 'wrong' }))).status, 429);
  assert.equal((await request('/api/admin/login', { ...jsonPost({ password: ENV.ADMIN_PASSWORD }), headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' } })).status, 403);
  const invalid = await running(t, { env: { ADMIN_PASSWORD: 'short' }, client: {} });
  assert.equal((await invalid.request('/api/admin/login', jsonPost({ password: 'short' }))).status, 503);
});

test('input validation and invalid JSON prevent upstream calls; valid whitespace phone is normalized', async t => {
  const writes = [];
  const { request } = await running(t, { env: ENV, client: { createRecord: async input => { writes.push(input); return 'record'; } }, now: () => NOW });
  for (const invalid of [{ ...INPUT, name: '' }, { ...INPUT, name: '张'.repeat(41) }, { ...INPUT, phone: '123' }, { ...INPUT, person: '未知' }, { ...INPUT, project: '未知' }, { ...INPUT, clientToken: 'invalid' }]) assert.equal((await request('/api/sign', jsonPost(invalid))).status, 400);
  const malformed = await request('/api/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad}' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).message, /格式错误/);
  assert.equal(writes.length, 0);
  const valid = await request('/api/sign', jsonPost({ ...INPUT, name: ' 张三 ', phone: '138 1234 5678', clientToken: UUID }));
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).recordId, 'record');
  assert.equal(writes[0].phone, INPUT.phone);
  assert.equal(writes[0].name, '张三');
  assert.equal(writes[0].clientToken, UUID);
});

test('API sanitizes unexpected errors, health exposes no secrets, and missing Feishu env yields 503', async t => {
  const { request } = await running(t, { env: ENV, client: { createRecord: async () => { throw new Error(ENV.FEISHU_APP_SECRET); } } });
  const response = await request('/api/sign', jsonPost(INPUT));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes(ENV.FEISHU_APP_SECRET), false);
  const health = await request('/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { success: true, status: 'ok' });
  const unconfigured = await running(t, { env: {} });
  assert.equal((await unconfigured.request('/api/sign', jsonPost(INPUT))).status, 503);
});
