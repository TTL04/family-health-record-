// Small fetch wrapper shared by all pages.
// Auth rides on the fhr_session HttpOnly cookie; a 401 sends the browser
// back to the login page (except on the login page itself, where the
// error is shown inline instead).

export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !opts.formData) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const onLogin = location.pathname === '/login.html';
    const isAuthCall = path.startsWith('/api/auth/');
    if (!onLogin && !isAuthCall) {
      location.href = '/login.html';
      throw new Error('请先登录');
    }
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

// One server may host several family archives. The active patient is a
// per-device choice stored in localStorage, so timelines never mix.
export function activePatient(patients) {
  const saved = localStorage.getItem('fhr.patient');
  const found = patients.find(p => p.id === saved) || null;
  return found || patients[0] || null;
}

export function setActivePatient(id) {
  localStorage.setItem('fhr.patient', id);
}

// Leave no stale patient choice behind when the archive list changes
// (e.g. after claiming or binding an archive).
export function clearActivePatient() {
  localStorage.removeItem('fhr.patient');
}

export function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
