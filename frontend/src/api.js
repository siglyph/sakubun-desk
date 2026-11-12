// Thin wrapper over fetch: JSON in, JSON out, and one error shape { code, message }.
async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (e) {
    if (e.name === 'AbortError') throw { code: 'cancelled', message: '' };
    throw { code: 'offline', message: 'Can’t reach the Sakubun Desk server. Check that the backend is running.' };
  }
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    throw { code: body.code || 'http_' + res.status, message: body.message || 'The server returned an error. Try again.' };
  }
  return res.json();
}

export const api = {
  get(path, params = {}, signal) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    return request(qs ? `${path}?${qs}` : path, { signal });
  },
  post(path, body, signal) {
    return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  },
};

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('sakubun.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('sakubun.' + key, JSON.stringify(value)); } catch { /* storage is a convenience only */ }
  },
};
