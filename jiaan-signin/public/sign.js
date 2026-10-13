'use strict';
(() => {
  const form = document.getElementById('sign-form');
  const button = document.getElementById('submit');
  const status = document.getElementById('sign-status');
  let pending = false;
  let previousData = '';
  let clientToken = '';
  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function message(value, error = false) {
    status.textContent = value;
    status.classList.toggle('error', error);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const data = {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.replace(/\s/g, ''),
      person: document.getElementById('person').value,
      project: document.getElementById('project').value
    };
    if (!data.name || [...data.name].length > 40) { message('请输入 1 至 40 个字符的姓名。', true); return; }
    if (!/^1[3-9]\d{9}$/.test(data.phone)) { message('请输入正确的 11 位中国大陆手机号码。', true); return; }
    const fingerprint = JSON.stringify(data);
    try {
      if (fingerprint !== previousData || !clientToken) {
        clientToken = uuid();
        previousData = fingerprint;
      }
    } catch { message('当前浏览器不支持安全提交，请使用微信、Edge 或 Chrome 打开正式 HTTPS 网址。', true); return; }
    pending = true;
    button.disabled = true;
    button.textContent = '正在签到…';
    form.setAttribute('aria-busy', 'true');
    message('正在提交，请稍候。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('/api/sign', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({...data, clientToken}), signal: controller.signal
      });
      let result;
      try { result = await response.json(); }
      catch { throw new Error('提交结果尚未确认，请先让工作人员在后台核对。保留当前页面重试可减少重复签到。'); }
      if (!response.ok || result.success !== true) {
        message(result.message || result.error || '签到未成功，请稍后重试或联系工作人员。', true);
        return;
      }
      form.hidden = true;
      const success = document.getElementById('ok');
      success.hidden = false;
      success.focus();
    } catch (error) {
      message(error.name === 'AbortError' || error instanceof TypeError
        ? '网络中断或响应超时，提交结果尚未确认。请先让工作人员在后台核对；保留当前页面重试可减少重复签到。'
        : error.message, true);
    } finally {
      clearTimeout(timer);
      pending = false;
      button.disabled = false;
      button.textContent = '立即签到';
      form.removeAttribute('aria-busy');
    }
  });
})();
