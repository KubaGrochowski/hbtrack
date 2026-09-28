/* Grochu's tracker — konto i synchronizacja z Supabase (logowanie e-mailem i hasłem).
   Bez zewnętrznych bibliotek: Supabase Auth (GoTrue) i REST (PostgREST) przez fetch.

   Model synchronizacji: stan aplikacji jest spłaszczany do elementów (nawyk, wpis, notatka, kolejność, start).
   Każdy element ma znacznik czasu ostatniej zmiany; przy łączeniu wygrywa nowszy (także usunięcia).
   W chmurze jest jeden wiersz na użytkownika: tabela user_data (user_id, data jsonb, updated_at). */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://xumjkmfctdutouvfgzsh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_EPRQnKETbD-CYt_TXALc8Q_v_PoC0yK'; // klucz publiczny (przeglądarkowy)
  const AUTH_KEY = 'hbtrack.auth';
  const META_KEY = 'hbtrack.sync';

  /* ---------- pamięć lokalna ---------- */
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } };

  /* ---------- spłaszczanie stanu ---------- */
  function flatten(s) {
    const items = { start: s.start, order: s.habits.map(h => h.id) };
    s.habits.forEach(h => { items['h:' + h.id] = h; });
    Object.entries(s.entries || {}).forEach(([hid, days]) => Object.entries(days).forEach(([k, v]) => { if (v != null) items[`e:${hid}|${k}`] = v; }));
    Object.entries(s.notes || {}).forEach(([k, v]) => { if (v) items['n:' + k] = v; });
    return items;
  }
  function unflatten(items) {
    const habitsById = {};
    Object.keys(items).forEach(k => { if (k.startsWith('h:')) habitsById[k.slice(2)] = items[k]; });
    const order = (items.order || []).filter(id => habitsById[id]);
    Object.keys(habitsById).forEach(id => { if (!order.includes(id)) order.push(id); });
    const entries = {}, notes = {};
    Object.keys(items).forEach(k => {
      if (k.startsWith('e:')) { const [hid, day] = k.slice(2).split('|'); if (habitsById[hid]) (entries[hid] ??= {})[day] = items[k]; }
      else if (k.startsWith('n:')) notes[k.slice(2)] = items[k];
    });
    return { start: items.start, habits: order.map(id => habitsById[id]), entries, notes };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Łączenie dwóch dokumentów {items, ts}: dla każdego klucza wygrywa nowszy znacznik (remis → chmura).
  function merge(local, remote) {
    const items = {}, ts = {};
    const keys = new Set([...Object.keys(local.ts), ...Object.keys(remote.ts), ...Object.keys(local.items), ...Object.keys(remote.items)]);
    keys.forEach(k => {
      const lt = local.ts[k] || 0, rt = remote.ts[k] || 0;
      const src = lt > rt ? local : remote;
      ts[k] = Math.max(lt, rt);
      if (k in src.items) items[k] = src.items[k];
    });
    return { items, ts };
  }

  /* ---------- sieć ---------- */
  async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await fetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { }
    if (!res.ok) { const err = new Error(json?.msg || json?.message || json?.error_description || json?.error || `HTTP ${res.status}`); err.status = res.status; err.code = json?.error_code || json?.code; throw err; }
    return json;
  }

  /* ---------- sesja ---------- */
  let session = read(AUTH_KEY);
  const saveSession = s => {
    session = s && { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user_id: s.user?.id || session?.user_id, email: s.user?.email || session?.email };
    write(AUTH_KEY, session);
  };
  async function token() {
    if (!session) throw Object.assign(new Error('Niezalogowany'), { status: 401 });
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try {
      saveSession(await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } }));
      return session.access_token;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) { saveSession(null); emit(); }
      throw e;
    }
  }

  /* ---------- połączenie z aplikacją ---------- */
  let app = null;               // { getState, applyState }
  let status = 'idle';          // idle | syncing | ok | offline | error
  let lastSync = null, lastError = '';
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f());

  function meta() { return read(META_KEY) || { flat: null, ts: {}, dirty: false }; }
  // Wywoływane po każdym lokalnym zapisie: znajduje zmienione elementy i nadaje im znacznik czasu.
  function trackLocal() {
    const m = meta(), flat = flatten(app.getState()), now = Date.now();
    if (!m.flat) { // pierwsze uruchomienie: istniejące dane dostają stary znacznik (przy łączeniu nic nie ginie, remis → chmura)
      Object.keys(flat).forEach(k => { m.ts[k] = 1; });
    } else {
      new Set([...Object.keys(m.flat), ...Object.keys(flat)]).forEach(k => { if (!same(m.flat[k], flat[k])) { m.ts[k] = now; m.dirty = true; } });
    }
    m.flat = flat;
    write(META_KEY, m);
  }

  let timer = null, running = null;
  function schedule(ms = 1200) { clearTimeout(timer); if (session) timer = setTimeout(sync, ms); }

  async function sync() {
    if (!session || !app) return;
    if (running) return running.then(() => sync());
    running = (async () => {
      status = 'syncing'; emit();
      try {
        const tok = await token();
        trackLocal();
        const m = meta();
        const rows = await api('/rest/v1/user_data?select=data', { token: tok });
        const remote = rows?.[0]?.data?.items ? rows[0].data : { items: {}, ts: {} };
        const local = { items: m.flat, ts: m.ts };
        const merged = merge(local, remote);
        if (!same(merged.items, local.items)) {
          app.applyState(unflatten(merged.items)); // nadpisuje stan aplikacji bez oznaczania zmian jako lokalnych
        }
        if (!same(merged, remote)) {
          await api('/rest/v1/user_data?on_conflict=user_id', {
            method: 'POST', token: tok,
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: { user_id: session.user_id, data: merged, updated_at: new Date().toISOString() },
          });
        }
        write(META_KEY, { flat: merged.items, ts: merged.ts, dirty: false });
        status = 'ok'; lastSync = new Date(); lastError = '';
      } catch (e) {
        status = navigator.onLine === false || e instanceof TypeError ? 'offline' : 'error';
        lastError = e.message || String(e);
      } finally { running = null; emit(); }
    })();
    return running;
  }

  /* ---------- API dla aplikacji ---------- */
  window.Cloud = {
    get user() { return session ? { email: session.email, id: session.user_id } : null; },
    get status() { return status; },
    get lastSync() { return lastSync; },
    get lastError() { return lastError; },
    get dirty() { return !!meta().dirty; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },

    attach(a) {
      app = a;
      if (!read(META_KEY)) trackLocal();
      if (session) sync();
      window.addEventListener('online', () => schedule(200));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
      setInterval(() => { if (!document.hidden) schedule(0); }, 60000);
    },
    // po każdym lokalnym zapisie
    changed() { if (!app) return; trackLocal(); schedule(); },

    // Logowanie e-mailem i hasłem (potwierdzanie maila jest wyłączone w Supabase, więc konto działa od razu).
    async signIn(email, password) {
      saveSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })); emit();
      await sync();
    },
    async signUp(email, password) {
      const s = await api('/auth/v1/signup', { method: 'POST', body: { email, password } });
      if (!s?.access_token) throw Object.assign(new Error('Konto utworzone, ale wymaga potwierdzenia e-mailem'), { code: 'needs_confirm' });
      saveSession(s); emit();
      await sync();
    },
    // Wylogowanie: najpierw wysyła zmiany; jeśli się nie da, nie wylogowuje (żeby nic nie zginęło).
    async signOut() {
      if (!session) return;
      await sync();
      if (status !== 'ok') throw new Error('Brak połączenia — najpierw trzeba wysłać zmiany do chmury.');
      try { await api('/auth/v1/logout', { method: 'POST', token: session.access_token }); } catch (_) { }
      saveSession(null); write(META_KEY, null);
      status = 'idle'; lastSync = null; emit();
    },
    syncNow: () => sync(),
  };
})();
