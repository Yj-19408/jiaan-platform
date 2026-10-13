'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const pageSize = 50;
  let signedIn = false;
  let busy = false;
  let allItems = [];
  let page = 1;
  let generation = 0;
  const controllers = new Set();
  function setStatus(id, text, error = false) {
    byId(id).textContent = text;
    byId(id).classList.toggle('error', error);
  }
  function loggedOut(text = '') {
    generation++;
    for (const controller of controllers) controller.abort();
    signedIn = false;
    allItems = [];
    page = 1;
    byId('dashboard').hidden = true;
    byId('login-panel').hidden = false;
    byId('password').value = '';
    byId('records').replaceChildren();
    byId('projects').replaceChildren();
    byId('people').replaceChildren();
    byId('total').textContent = '—';
    setStatus('login-status', text, Boolean(text));
  }
  function loggedIn() {
    signedIn = true;
    byId('login-panel').hidden = true;
    byId('dashboard').hidden = false;
    byId('password').value = '';
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        const error = new Error(data.message || data.error || '数据读取失败，请稍后重试。');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取超时，请重新刷新。');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('网络连接异常，暂时无法读取数据。');
      throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function dateText(value) {
    if (!value) return '时间未填写';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '时间未填写';
    return date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
  }
  function renderCounts(id, items) {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = item.name;
      const count = document.createElement('strong'); count.textContent = `${item.count} 人`;
      li.append(name, count); fragment.append(li);
    }
    byId(id).replaceChildren(fragment);
  }
  function renderList() {
    const pages = Math.max(1, Math.ceil(allItems.length / pageSize));
    page = Math.min(Math.max(1, page), pages);
    const start = (page - 1) * pageSize;
    const visible = allItems.slice(start, start + pageSize);
    const fragment = document.createDocumentFragment();
    for (const item of visible) {
      const li = document.createElement('li');
      const heading = document.createElement('div'); heading.className = 'record-heading';
      const name = document.createElement('strong'); name.textContent = item.name || '未填写姓名';
      const phone = document.createElement('span'); phone.textContent = item.phone || '未填写电话';
      heading.append(name, phone); li.append(heading);
      const category = document.createElement('p'); category.textContent = `${item.person || '未填写类别'} · ${item.project || '未填写项目'}`;
      const time = document.createElement('p'); time.className = 'small'; time.textContent = dateText(item.time);
      li.append(category, time); fragment.append(li);
    }
    if (allItems.length === 0) { const li = document.createElement('li'); li.textContent = '暂无签到记录'; fragment.append(li); }
    byId('records').replaceChildren(fragment);
    byId('list-summary').textContent = allItems.length
      ? `共 ${allItems.length} 条 · 当前显示第 ${start + 1}–${start + visible.length} 条`
      : '共 0 条';
    byId('page-info').textContent = `${page} / ${pages}`;
    byId('previous').disabled = page <= 1;
    byId('next').disabled = page >= pages;
  }
  async function refresh() {
    if (!signedIn || busy) return;
    busy = true;
    const current = generation;
    byId('refresh').disabled = true;
    setStatus('dashboard-status', '正在读取全部签到记录…');
    try {
      const [list, stats] = await Promise.all([request('/api/list'), request('/api/stats')]);
      if (generation !== current || !signedIn) return;
      if (!Array.isArray(list.items) || list.total !== list.items.length || !Number.isInteger(stats.total)
          || !Array.isArray(stats.projects) || !Array.isArray(stats.people)) throw new Error('数据格式异常，请重新刷新。');
      allItems = list.items;
      renderList();
      byId('total').textContent = String(stats.total);
      renderCounts('projects', stats.projects); renderCounts('people', stats.people);
      byId('updated').textContent = `最后更新：${dateText(stats.updatedAt)}`;
      setStatus('dashboard-status', list.total === stats.total ? '' : '读取期间有新签到，人数与名单可能短暂不同，请刷新查看最新数据。');
    } catch (error) {
      if (generation !== current || !signedIn) return;
      if (error.status === 401) loggedOut('登录已过期，请重新登录。');
      else setStatus('dashboard-status', `${error.message} 已显示的数据保持上次读取结果。`, true);
    } finally { busy = false; byId('refresh').disabled = false; }
  }
  byId('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('login-button');
    if (button.disabled) return;
    button.disabled = true;
    setStatus('login-status', '正在登录…');
    try {
      await request('/api/admin/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:byId('password').value})});
      generation++; loggedIn(); await refresh();
    } catch (error) { setStatus('login-status', error.message, true); }
    finally { button.disabled = false; }
  });
  byId('logout').addEventListener('click', async () => {
    const button = byId('logout'); button.disabled = true;
    try { await request('/api/admin/logout', {method:'POST'}); loggedOut(); }
    catch (error) { setStatus('dashboard-status', `退出失败：${error.message}`, true); }
    finally { button.disabled = false; }
  });
  byId('refresh').addEventListener('click', refresh);
  byId('previous').addEventListener('click', () => { page--; renderList(); });
  byId('next').addEventListener('click', () => { page++; renderList(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  request('/api/admin/session').then(() => { loggedIn(); return refresh(); }).catch(error => {
    loggedOut(error.status === 401 ? '' : error.message);
  });
})();
