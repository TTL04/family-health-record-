// Small fetch wrapper shared by all pages.
// Sends the family access code (if set) and turns errors into thrown Errors.

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !opts.formData) headers['Content-Type'] = 'application/json';
  const code = localStorage.getItem('fhr.access');
  if (code) headers['X-Access-Code'] = code;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const next = prompt('这是受保护的家庭档案，请输入访问码');
    if (next == null) throw new Error('需要访问码才能使用');
    localStorage.setItem('fhr.access', next);
    return api(path, opts);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
