/* Grochu's tracker — tygodniowy tracker nawyków. Dane zapisywane lokalnie w przeglądarce (localStorage). */
(() => {
  'use strict';

  const STORAGE_KEY = 'hbtrack.v1';
  const DAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
  const DAYS_FULL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
  const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const TIMES = [['am', 'Rano'], ['pm', 'Popołudnie'], ['eve', 'Wieczór']];

  /* ---------- daty ---------- */
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dow = d => (d.getDay() + 6) % 7; // 0 = poniedziałek
  const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return addDays(x, -dow(x)); };
  const todayKey = () => key(new Date());
  // Numer tygodnia liczony od startu aplikacji: tydzień startu = 1.
  const weekNo = ws => Math.round((startOfWeek(ws) - fromKey(state.start)) / (7 * 86400000)) + 1;
  // Start = poniedziałek tygodnia pierwszego nawyku (albo bieżący tydzień, gdy brak danych).
  function withStart(s) {
    if (!s.start) {
      const c = s.habits.map(h => h.created).filter(Boolean).sort()[0];
      s.start = key(startOfWeek(c ? fromKey(c) : new Date()));
    }
    if (!s.notes || typeof s.notes !== 'object') s.notes = {};
    if (!s.skips || typeof s.skips !== 'object') s.skips = {};
    if (!s.spent || typeof s.spent !== 'object') s.spent = {};
    if (!s.breaks || typeof s.breaks !== 'object') s.breaks = {}; // przerwy (urlop, choroba): id → { from, to }
    if (!s.meals || typeof s.meals !== 'object') s.meals = {}; // posiłki: id → { name, items: [{ n, g, p, c, f }] (makro na 100 g), photo, created }
    if (!s.food || typeof s.food !== 'object') s.food = {};    // zjedzone: dzień → id wpisu → { mid, name, p, c, f (na porcję), x (porcje), t }
    if (!s.goals || typeof s.goals !== 'object') s.goals = null; // zapotrzebowanie: { kcal, p, c, f }
    // Timer jest osobnym rodzajem nawyku: dawne „tak/nie z czasem” i „liczbowe z timerem” stają się nawykami-timerami w minutach.
    s.habits.forEach(h => {
      const e = s.entries[h.id];
      if (h.type === 'bool' && h.timer && h.dur) {
        const m = Math.round(h.timer === 'h' ? h.dur * 60 : h.dur);
        Object.assign(h, { type: 'num', target: m, unit: 'min', step: 5, clock: true, timer: 'min' }); delete h.dur;
        if (e) Object.keys(e).forEach(k => { if (e[k] >= 1) e[k] = m; else delete e[k]; });
      } else if (h.type === 'num' && (h.timer === 'min' || h.timer === 'h') && !h.clock) {
        if (h.timer === 'h') { h.target = +(h.target * 60).toFixed(2); h.step = Math.max(1, Math.round(h.step * 60)); if (e) Object.keys(e).forEach(k => { e[k] = +(e[k] * 60).toFixed(2); }); }
        Object.assign(h, { unit: 'min', clock: true, timer: 'min' });
      }
    });
    Object.keys(s.spent).forEach(k => { if ((k.split('|')[1] || '') < todayKey()) delete s.spent[k]; });
    // odpuszczone zaległości starsze niż tydzień nie są już potrzebne
    const old = key(addDays(new Date(), -7));
    Object.keys(s.skips).forEach(k => { if ((k.split('|')[1] || '') < old) delete s.skips[k]; });
    return s;
  }

  /* ---------- stan ---------- */
  let state = load();
  save(); // utrwala datę startu (tydzień 1)
  let weekStart = startOfWeek(new Date());
  // Telefon: widok jednego dnia (selDay); komputer: cały tydzień.
  const mq = window.matchMedia('(max-width:680px)');
  const isMobile = () => mq.matches;
  const dayOnly = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let selDay = dayOnly(new Date());
  // Animacje: wejście listy (po nawigacji), kierunek przesunięcia dnia/tygodnia, ostatnio zmienione kółko.
  let animList = true, slideDir = 0, justCell = null;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const levels = new Map(); // 'idNawyku|data' → poziom wody (%) z poprzedniego rysowania, żeby płynnie przelać do nowego
  let userAct = false, hero = { k: null, v: null }, party = false, partyLater = false, timerDone = null, recordToast = null;
  let edit = null;
  let rowMenu = null;
  let view = 'week';
  let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  try { const v = localStorage.getItem('hbtrack.view'); if (v === 'calendar' || v === 'summary' || v === 'meals') view = v; } catch (_) { }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.habits) && s.entries) {
          return withStart(s);
        }
      }
    } catch (_) { }
    return withStart({ habits: [], entries: {} });
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) { toast('Nie udało się zapisać danych w przeglądarce'); return; }
    window.Cloud?.changed();
  }
  // Stan z chmury (po synchronizacji): zapis lokalny bez oznaczania go jako zmiany z tego urządzenia.
  function applyState(s) {
    state = withStart({ habits: s.habits || [], entries: s.entries || {}, notes: s.notes || {}, skips: s.skips || {}, spent: s.spent || {}, breaks: s.breaks || {}, meals: s.meals || {}, food: s.food || {}, goals: s.goals || null, start: s.start });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { }
    render();
  }
  const habitsActive = () => state.habits.filter(h => !h.archived);
  const getVal = (h, k) => { const v = state.entries[h.id]?.[k]; return v == null ? null : v; };
  function setVal(h, k, v) {
    state.entries[h.id] ??= {};
    if (v == null) delete state.entries[h.id][k]; else state.entries[h.id][k] = v;
    userAct = true;
    save();
  }

  /* ---------- logika ---------- */
  const prog = (h, v) => v == null ? 0 : h.type === 'bool' ? (v >= 1 ? 1 : 0) : Math.min(1, v / h.target);
  // Przerwa: dni wolne od wszystkich nawyków — nie liczą się do procentów, nie przerywają serii, nie dają zaległości.
  const breakAt = k => Object.values(state.breaks || {}).find(b => b.from <= k && k <= b.to) || null;
  // „X razy w tygodniu”: ile razy zrobione w tygodniu dnia d (przed d albo do dziś włącznie)
  function weekDone(h, d, before) {
    const ws = startOfWeek(d), t = todayKey(), lim = before ? key(d) : t; let n = 0;
    for (let i = 0; i < 7; i++) { const k = key(addDays(ws, i)); if (k > lim || (before && k === lim)) break; if (prog(h, getVal(h, k)) >= 1) n++; }
    return n;
  }
  function status(h, d) {
    const k = key(d), t = todayKey();
    if (k < h.created) return 'pre'; // nawyku jeszcze nie było
    if (!h.days.includes(dow(d))) return 'off';
    if (breakAt(k)) return 'rest';
    if (k > t) return 'future';
    const v = getVal(h, k);
    let st;
    if (h.type === 'bool') st = v === 1 ? 'done' : v === 0 ? 'miss' : k === t ? 'pending' : 'miss';
    else st = v == null || v === 0 ? (k === t ? 'pending' : 'miss') : v >= h.target ? 'done' : 'part';
    // X razy w tygodniu: niezrobiony dzień jest „dowolny”, chyba że inaczej nie da się już zmieścić limitu w tygodniu
    if (h.freq && (st === 'miss' || st === 'pending')) {
      if (weekDone(h, d, false) >= h.freq) return 'free';
      const need = h.freq - weekDone(h, d, true), left = 7 - dow(d);
      if (need < left) return 'free';
    }
    return st;
  }
  const nf = v => v.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  const fmt = (h, v) => v == null ? '' : h.type === 'bool' ? (v >= 1 ? '✓' : '✕') : v >= 1000 ? (v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + 'k' : nf(v);
  const tgt = h => { const per = h.freq ? `${h.freq}× w tygodniu` : h.days.length === 7 ? 'codziennie' : h.days.map(d => DAYS[d]).join(' '); return h.type === 'bool' ? per : `${nf(h.target)} ${h.unit} · ${per}`; };
  const weekDates = (ws = weekStart) => ALL.map(i => addDays(ws, i));

  // Jeden wzór dla wszystkich procentów: każdy zaplanowany nawyk ma równą wagę, suma postępów ÷ liczba nawyków do dziś włącznie
  // (tak/nie: 1 albo 0; liczbowy: wartość ÷ cel, najwyżej 1; bez wpisu = 0). Dni przyszłe się nie liczą.
  function periodPct(dates) {
    let n = 0, s = 0;
    dates.forEach(d => habitsActive().forEach(h => {
      const st = status(h, d); if (!['done', 'part', 'miss', 'pending'].includes(st)) return;
      n++; s += prog(h, getVal(h, key(d))); // nawyk liczbowy liczy się proporcjonalnie: 2 h z 10 h = 20% swojej części
    }));
    return n ? s / n : null;
  }
  const dayPct = d => periodPct([d]);
  // Seria: zrobione zaplanowane dni pod rząd, licząc wstecz od dziś (dziś bez wpisu i dni wolne nie przerywają).
  function streak(h) {
    let n = 0;
    const start = fromKey(h.created || state.start);
    for (let d = dayOnly(new Date()); d >= start; d = addDays(d, -1)) {
      const s = status(h, d);
      if (s === 'off' || s === 'pre' || s === 'pending' || s === 'rest' || s === 'free') continue;
      if (s === 'done') n++; else break;
    }
    return n;
  }
  // Rekord serii: najdłuższa seria w historii; prior = najlepsza z serii już zakończonych (do wykrycia nowego rekordu)
  function bestStreak(h) {
    let cur = 0, best = 0, prior = 0;
    const t = dayOnly(new Date());
    for (let d = fromKey(h.created || state.start); d <= t; d = addDays(d, 1)) {
      const s = status(h, d);
      if (s === 'done') { cur++; best = Math.max(best, cur); }
      else if (s === 'miss' || s === 'part') { prior = Math.max(prior, cur); cur = 0; }
    }
    return { best, prior };
  }
  // Najsłabszy dzień tygodnia: dzień z największym odsetkiem niezrobionych (min. 2 próby), bez dzisiaj
  function weakestDay(h) {
    const n = ALL.map(() => [0, 0]), t = dayOnly(new Date());
    for (let d = fromKey(h.created || state.start); d < t; d = addDays(d, 1)) {
      const s = status(h, d); if (!['done', 'part', 'miss'].includes(s)) continue;
      n[dow(d)][1]++; if (s !== 'done') n[dow(d)][0]++;
    }
    let best = -1, rate = 0;
    n.forEach(([f, c], i) => { if (c >= 2 && f && (f / c > rate || (f / c === rate && f > n[best][0]))) { best = i; rate = f / c; } });
    return best;
  }
  const noteOf = k => state.notes[k] || '';
  function setNote(k, text) {
    const t = text.trim();
    if (t) state.notes[k] = t; else delete state.notes[k];
    save();
  }
  // [zrobione, zaplanowane] dla danego dnia
  function dayDone(d) { const hs = habitsActive().filter(h => !['off', 'pre', 'rest', 'free'].includes(status(h, d))); return [hs.filter(h => status(h, d) === 'done').length, hs.length]; }
  const pct = p => Math.round(p * 100);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CHECK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DOTS = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg>';
  const PENCIL = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3l8-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4l3 3" stroke="currentColor" stroke-width="1.6"/></svg>';
  const UNDO = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.8 3.5L2.8 6.5l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const XMARK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const GRIP = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></g></svg>';
  const CLOCK = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5V8l2.4 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6v8.8L10.2 6z" fill="currentColor"/></svg>';
  const STOP = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="currentColor"/></svg>';
  // Wysokość wody w kółku tak, żeby zalana POWIERZCHNIA koła odpowiadała % celu (90% celu ≈ 84% wysokości, nie prawie pełne).
  const waterLevel = f => {
    if (f <= 0 || f >= 1) return f * 100;
    let lo = 0, hi = Math.PI * 2;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if ((m - Math.sin(m)) / (2 * Math.PI) < f) lo = m; else hi = m; }
    return +((1 - Math.cos(lo / 2)) / 2 * 100).toFixed(1);
  };
  const WATER = '<i class="wv"></i><i class="wv b"></i>';
  // Fale (morski motyw): ścieżka dłuższa niż widok, przesuwana w pętli o pełne okresy
  const wavePath = (amp, len) => { let d = 'M0 20'; for (let x = 0; x < 400; x += len) d += ` Q${x + len / 4} ${20 - amp} ${x + len / 2} 20 T${x + len} 20`; return d + ' V40 H0 Z'; };
  const SEA_SVG = `<svg class="waves" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path class="w1" d="${wavePath(5, 50)}"/><path class="w2" d="${wavePath(7, 100)}" transform="translate(0 3)"/><path class="w3" d="${wavePath(3, 50)}" transform="translate(0 9)"/></svg>`;
  const BOAT = '<svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="M12 2v14H4z" fill="currentColor" opacity=".9"/><path d="M14 5v11h7z" fill="currentColor" opacity=".55"/><path d="M2 18h22l-3 4H6z" fill="currentColor"/></svg>';
  const FLAME = '<svg width="11" height="13" viewBox="0 0 12 14" aria-hidden="true"><path d="M6 .5c.4 2.4 3.8 3.9 3.8 7.6a3.8 3.8 0 0 1-7.6 0c0-1.5.8-2.6 1.6-3.3.1 1.2.7 2 1.5 2.3C5 5.1 5.1 2.6 6 .5z" fill="currentColor"/></svg>';

  /* ---------- kalendarz ---------- */
  const monthOf = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const monthDays = ms => { const out = []; for (let d = new Date(ms); d.getMonth() === ms.getMonth(); d = addDays(d, 1)) out.push(d); return out; };
  const monthPct = ms => periodPct(monthDays(ms));

  // Kolor dnia w kalendarzu: 0% czerwony → 50% pomarańczowy → 100% zielony.
  const heat = p => p < 0.5
    ? `color-mix(in oklab, var(--warn) ${Math.round(p * 200)}%, var(--miss))`
    : `color-mix(in oklab, var(--accent) ${Math.round((p - 0.5) * 200)}%, var(--warn))`;
  const navBtn = dir => `<button class="navarr" data-nav="${dir}" ${dir < 0 && !canPrev() ? 'disabled' : ''} aria-label="${dir < 0 ? 'Wstecz' : 'Dalej'}">${dir < 0 ? '‹' : '›'}</button>`;
  function renderCalendar() {
    const t = todayKey(), days = monthDays(monthStart);
    let cal = `<div class="cal-nav">${navBtn(-1)}<div class="cal-h">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>${navBtn(1)}</div><div class="cal${animList ? ' enter' : ''}">`;
    for (let i = 0; i < dow(days[0]); i++) cal += `<span class="cd blank"></span>`;
    days.forEach((d, idx) => {
      const k = key(d), fut = k > t, pre = k < state.start, p = fut || pre ? null : dayPct(d);
      const note = noteOf(k);
      const cls = `cd${breakAt(k) && !pre ? ' rest' : ''}${fut ? ' fut' : ''}${pre ? ' pre' : ''}${p == null ? ' none' : ''}${p != null ? ' hi' : ''}${k === t ? ' today' : ''}${note ? ' has-note' : ''}`;
      const tip = esc(`${DAYS_FULL[dow(d)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}: ${p == null ? 'brak danych' : pct(p) + '%'}${note ? ' · ' + note : ''}`);
      cal += `<button class="${cls}" ${pre ? "disabled" : ""} data-goto="${key(startOfWeek(d))}" data-day="${k}" style="--i:${idx}${p == null ? '' : `;--heat:${heat(p)}`}" aria-label="${tip}"><b>${d.getDate()}</b>${p == null ? '' : `<small>${pct(p)}%</small>`}</button>`;
    });
    $('view-calendar').innerHTML = `<section class="panel">${cal}</div></section>`;
  }

  /* ---------- podsumowanie: wybór nawyku, potem tydzień albo miesiąc ---------- */
  let sumHabit = null, sumMode = 'week';
  const sumDates = () => sumMode === 'month' ? monthDays(monthStart) : weekDates();
  function renderSummary() {
    const t = todayKey(), box = $('view-summary');
    const h = habitsActive().find(x => x.id === sumHabit);
    if (!h) {
      sumHabit = null;
      box.innerHTML = `<div class="slist${animList ? ' enter' : ''}"><div class="grp later" style="padding-top:0">Wybierz nawyk</div>${habitsActive().map((x, i) => `<button class="sitem" data-sum-habit="${x.id}" style="--i:${i}"><b>${esc(x.name)}</b><small>${tgt(x)}</small><span aria-hidden="true">›</span></button>`).join('')}</div>`;
      return;
    }
    const dates = sumDates(), month = sumMode === 'month', first = dates[0], last = dates[dates.length - 1];
    const rng = month ? `${MONTHS_NOM[first.getMonth()]} ${first.getFullYear()}`
      : first.getMonth() === last.getMonth() ? `${first.getDate()}–${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`
      : `${first.getDate()} ${MONTHS_GEN[first.getMonth()].slice(0, 3)} – ${last.getDate()} ${MONTHS_GEN[last.getMonth()].slice(0, 3)}`;
    const cls = p => p == null ? '' : p >= 0.8 ? 'good' : p >= 0.5 ? 'mid' : 'bad';
    const lbl = d => `<span class="${key(d) === t ? 't' : ''}">${month ? (d.getDate() === 1 || d.getDate() % 5 === 0 ? d.getDate() : '') : DAYS[dow(d)]}</span>`;
    const rows = dates.map(d => ({ d, s: status(h, d), v: getVal(h, key(d)) }));
    let head, chart;
    if (h.type === 'num') {
      const vals = rows.filter(r => !['off', 'pre', 'future', 'rest'].includes(r.s) && r.v != null).map(r => r.v);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, p = avg == null ? null : avg / h.target;
      const scale = Math.max(h.target, ...vals, 0.0001) * 1.15;
      const bars = rows.map((r, j) => {
        if (['off', 'pre', 'rest'].includes(r.s)) return '<div class="sb none"><i></i></div>';
        if (r.s === 'future' || r.v == null) return `<div class="sb empty"><span>${r.s === 'future' ? '' : '–'}</span><i></i></div>`;
        return `<div class="sb ${r.v >= h.target ? 'hit' : 'low'}" style="--j:${j}"><span>${nf(r.v)}</span><i style="height:${Math.max(2, r.v / scale * 100)}%;background:${heat(Math.min(1, r.v / h.target))}"></i></div>`;
      }).join('');
      head = [avg == null ? 'brak wpisów' : `średnia <b>${nf(+avg.toFixed(2))} ${esc(h.unit)}</b>`, p];
      chart = `<div class="sbars${month ? ' m' : ''}" style="--n:${dates.length}">${bars}<em class="starget" style="bottom:${h.target / scale * 100}%"><span>cel ${nf(h.target)}</span></em></div><div class="sdays${month ? ' m' : ''}" style="--n:${dates.length}">${dates.map(lbl).join('')}</div>`;
    } else {
      const counted = rows.filter(r => ['done', 'miss', 'pending'].includes(r.s)), done = counted.filter(r => r.s === 'done').length;
      head = [counted.length ? `<b>${done} z ${counted.length}</b> ${counted.length === 1 ? 'dnia' : 'dni'}` : 'jeszcze nie zaczęte', counted.length ? done / counted.length : null];
      // tylko dni, w które nawyk obowiązuje (np. Pn, Śr, Pt); bez wyróżniania dzisiejszego dnia
      const cols = [...h.days].sort((x, y) => x - y), n = cols.length;
      const cell = r => `<div class="sc ${r.s}">${month ? `<b>${r.d.getDate()}</b>` : r.s === 'done' ? CHECK : r.s === 'miss' ? XMARK : ''}</div>`;
      const names = `<div class="sdays" style="--n:${n}">${cols.map(d => `<span>${DAYS[d]}</span>`).join('')}</div>`;
      if (month) {
        let cells = '';
        for (let ws = startOfWeek(first); ws <= last; ws = addDays(ws, 7)) cols.forEach(d => {
          const day = addDays(ws, d), r = day.getMonth() === first.getMonth() ? rows[day.getDate() - 1] : null;
          cells += r ? cell(r) : '<div class="sc blank"></div>';
        });
        chart = `${names}<div class="scells m" style="--n:${n}">${cells}</div>`;
      } else {
        chart = `<div class="scells" style="--n:${n}">${rows.filter(r => cols.includes(dow(r.d))).map(cell).join('')}</div>${names}`;
      }
    }
    // rekord serii i najsłabszy dzień tygodnia
    const bs = bestStreak(h).best, wd = weakestDay(h);
    const chips = bs || wd >= 0 ? `<div class="schips">${bs ? `<span class="schip rec">${FLAME}rekord ${bs}</span>` : ''}${wd >= 0 ? `<span class="schip weak">najsłabszy: ${DAYS_FULL[wd].toLowerCase()}</span>` : ''}</div>` : '';
    box.innerHTML = `<div class="sbar"><button class="spick" data-sum-pick aria-label="Zmień nawyk"><b>${esc(h.name)}</b><span aria-hidden="true">▾</span></button>
        <div class="seg smode" role="group" aria-label="Okres"><button data-sum-mode="week" class="${month ? '' : 'on'}">Tydzień</button><button data-sum-mode="month" class="${month ? 'on' : ''}">Miesiąc</button></div></div>
      <div class="snav">${navBtn(-1)}<b>${rng}</b>${navBtn(1)}</div>
      <article class="scard${animList ? ' enter' : ''}"><header><div><h3>${esc(h.name)}</h3><small>${head[0]}</small></div><strong class="${cls(head[1])}">${head[1] == null ? '—' : pct(head[1]) + '%'}</strong></header>${chart}${chips}</article>`;
  }

  /* ---------- render ---------- */
  const $ = id => document.getElementById(id);
  // Płynne przeliczanie dużego procentu (zamiast skoku liczby).
  // unit: '%' (procent nawyków) albo 'kcal' (posiłki: sama liczba); przy zmianie jednostki bez przeliczania
  let shownPct = null, shownUnit = '%', pctRaf = 0, pctEnd = 0;
  function showPct(v, unit = '%') {
    const el = $('week-pct'); cancelAnimationFrame(pctRaf); clearTimeout(pctEnd);
    if (v == null) { el.textContent = '—'; shownPct = null; return; }
    const out = x => unit === '%' ? Math.round(x) + '%' : Math.round(x).toLocaleString('pl-PL');
    const from = shownUnit === unit ? shownPct ?? v : v, t0 = performance.now(), dur = 350;
    shownPct = v; shownUnit = unit;
    if (document.hidden || from === v) { el.textContent = out(v); return; }
    const tick = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = out(from + (v - from) * e);
      if (k < 1) pctRaf = requestAnimationFrame(tick);
    };
    tick(t0);
    pctEnd = setTimeout(() => { cancelAnimationFrame(pctRaf); el.textContent = out(v); }, dur + 50); // zapas, gdy karta w tle wstrzyma klatki
  }
  function render() {
    const mobile = isMobile();
    if (mobile) weekStart = startOfWeek(selDay);
    const dates = weekDates(), t = todayKey(), end = dates[6];
    const shown = mobile ? [selDay] : dates;
    const sameMonth = dates[0].getMonth() === end.getMonth();
    const range = sameMonth
      ? `${dates[0].getDate()}–${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`
      : `${dates[0].getDate()} ${MONTHS_GEN[dates[0].getMonth()]} – ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
    // „Dziś” tylko wtedy, gdy oglądasz coś innego niż teraz: inny tydzień (komputer), inny dzień (telefon), inny miesiąc (kalendarz).
    const now = new Date();
    const atNow = view === 'calendar' ? key(monthStart) === key(monthOf(now))
      : view === 'meals' ? key(mealDay) === key(now)
      : view === 'summary' ? (sumMode === 'month' ? key(monthStart) === key(monthOf(now)) : key(weekStart) === key(startOfWeek(now)))
      : mobile ? key(selDay) === key(now) : key(weekStart) === key(startOfWeek(now));
    $('this-week').closest('.weeknav').hidden = atNow;
    document.querySelectorAll('.vtab[data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
    $('view-week').hidden = view !== 'week';
    $('view-calendar').hidden = view !== 'calendar';
    $('view-summary').hidden = view !== 'summary';
    $('view-meals').hidden = view !== 'meals';
    $('meal-dock').hidden = view !== 'meals';
    document.body.classList.toggle('meals-on', view === 'meals');
    $('add-habit').hidden = view !== 'week'; // nawyki dodaje się tylko w widoku tygodnia
    if (view === 'calendar') {
      const m = monthPct(monthStart);
      $('week-label').textContent = `${MONTHS_NOM[monthStart.getMonth()]} ${monthStart.getFullYear()}`;
      $('week-label').hidden = false;
      showPct(m == null ? null : pct(m));
      $('today-label').textContent = '';
    } else if (view === 'summary') {
      const w = periodPct(sumDates().filter(d => key(d) <= t));
      $('week-label').textContent = sumMode === 'month' ? MONTHS_NOM[monthStart.getMonth()] + ' ' + monthStart.getFullYear() : range;
      $('week-label').hidden = false;
      showPct(w == null ? null : pct(w));
      $('today-label').textContent = sumMode === 'month' ? 'miesiąc' : 'tydzień';
    } else if (view === 'meals') {
      // posiłki: duża liczba = ile kcal zostało do celu (bez celu: ile zjedzone)
      const e = eatenOn(key(mealDay)), gk = state.goals?.kcal, left = gk ? gk - e.kcal : null;
      $('week-label').textContent = `${mealDay.getDate()} ${MONTHS_GEN[mealDay.getMonth()]} ${mealDay.getFullYear()}`;
      $('week-label').hidden = false;
      showPct(gk ? Math.abs(left) : e.kcal, 'kcal');
      $('today-label').innerHTML = !gk ? 'kcal zjedzone' : left >= 0 ? 'kcal zostało' : '<em class="over">kcal ponad cel</em>';
      $('empty').hidden = true;
      renderMeals();
      return;
    } else {
      $('week-label').textContent = range;
      $('week-label').hidden = mobile; // na telefonie bez zakresu tygodnia u góry
      // Duży procent liczy jeden dzień: na telefonie oglądany, na komputerze dzisiejszy.
      const day = mobile ? selDay : dayOnly(new Date());
      const dp = dayPct(day), [a, b] = dayDone(day);
      showPct(dp == null ? (key(day) > t || breakAt(key(day)) ? null : 0) : pct(dp)); // przerwa: bez procentu
      const hv = dp == null ? null : pct(dp);
      if (userAct && hero.k === key(day) && hero.v != null && hero.v < 100 && hv === 100) party = true;
      if (hv !== 100) partyLater = false;
      hero = { k: key(day), v: hv };
      $('today-label').innerHTML = `<em>${a}/${b}</em>`;
    }

    $('day-head').classList.toggle('single', mobile);
    $('day-head').innerHTML = mobile
      ? `${navBtn(-1)}<div class="dayname${key(selDay) === t ? ' t' : ''}">${DAYS_FULL[dow(selDay)]}<em>, ${selDay.getDate()} ${MONTHS_GEN[selDay.getMonth()]}</em></div>${navBtn(1)}`
      : `<span class="lbl">${navBtn(-1)}</span><div class="o-track">${dates.map(d => { const k = key(d), n = noteOf(k); return `<span class="${k === t ? 't' : ''}"><button class="dh${n ? ' has-note' : ''}" data-note="${k}" aria-label="Notatka: ${DAYS_FULL[dow(d)]} ${d.getDate()}">${DAYS[dow(d)]}<em>${d.getDate()}</em></button></span>`; }).join('')}</div><span class="sp">${navBtn(1)}</span>`;

    const hs = habitsActive();
    $('empty').hidden = hs.length > 0;
    $('day-head').hidden = hs.length === 0;
    const noteBox = $('day-note');
    noteBox.hidden = !mobile || !hs.length;
    if (!noteBox.hidden && document.activeElement?.id !== 'note-input') {
      noteBox.innerHTML = `<input id="note-input" type="text" maxlength="140" placeholder="Notatka" autocomplete="off" value="${esc(noteOf(key(selDay)))}" data-k="${key(selDay)}">`;
    }
    if (!hs.length) {
      $('empty').innerHTML = `Nie masz jeszcze nawyków. Kliknij „+ Dodaj”, żeby dodać pierwszy.`;
      $('list').innerHTML = '';
      $('view-calendar').innerHTML = '';
      $('view-summary').innerHTML = '';
      $('view-summary').hidden = true;
      $('view-week').hidden = false;
      return;
    }
    if (view === 'calendar') renderCalendar();
    if (view === 'summary') renderSummary();
    // Najpierw nawyki zaplanowane na dzień odniesienia, potem pozostałe (kolejność w grupach bez zmian).
    // Telefon: wybrany dzień. Komputer: dziś, jeśli oglądany tydzień go zawiera; w innych tygodniach bez sortowania.
    // Nawyki „nie dziś” zawsze na końcu, za linią. Pora dnia to tylko etykieta na kafelku.
    // Nawyki dodane po oglądanym tygodniu (telefon: po wybranym dniu) trafiają na sam dół do sekcji „Dodane później”.
    const ref = mobile ? selDay : (key(dates[0]) <= t && t <= key(end) ? fromKey(t) : null);
    const isLater = h => h.created > key(mobile ? selDay : end);
    const isOff = h => ref && status(h, ref) === 'off';
    const cur = hs.filter(h => !isLater(h)), later = hs.filter(isLater);
    const onList = cur.filter(h => !isOff(h)), offList = cur.filter(isOff);
    // Zaległe z wczoraj: tylko nawyki tak/nie, które nie są codzienne, niezrobione i nieodpuszczone (liczbowe i codzienne nie trafiają do zaległych). Telefon: osobna sekcja na górze dzisiejszego dnia; komputer: plakietka przy nazwie.
    // Sięgają dwa dni wstecz: wczorajsze są pomarańczowe, przedwczorajsze (nienadrobione) czerwone.
    const showOverdue = mobile ? key(selDay) === t : key(dates[0]) <= t && t <= key(end);
    // nawyk ma już kolejny termin między tamtym dniem a dziś (np. siłownia pn i wt) — wtedy zaległość traci sens
    const nextDue = (h, age) => { for (let i = age - 1; i >= 0; i--) if (h.days.includes(dow(addDays(dayOnly(new Date()), -i)))) return true; return false; };
    const overdue = [], skipped = []; // skipped: odpuszczone krzyżykiem, do przywrócenia z dołu listy
    if (showOverdue) for (const age of [2, 1]) {
      const d = addDays(dayOnly(new Date()), -age), k = key(d);
      hs.forEach(h => { if (h.type !== 'num' && !h.freq && h.days.length < 7 && !nextDue(h, age) && ['miss', 'part'].includes(status(h, d))) (state.skips[h.id + '|' + k] ? skipped : overdue).push({ h, d, k, age }); });
    }
    let rowIdx = 0;
    const brk = breakAt(key(mobile ? selDay : dayOnly(new Date())));
    let html = mobile && overdue.length ? `<div class="grp later od-h" data-fk="g:od">Zaległe</div>` + overdue.map(odRowHtml).join('') + `<div class="grp sep" data-fk="g:od-sep"></div>` : '';
    if (brk) html = `<div class="break-card" data-fk="g:break"><div class="bk-sea" aria-hidden="true">${SEA_SVG}<i class="bk-boat">${BOAT}</i></div><div class="bk-txt"><b>Przerwa</b><small>do ${fromKey(brk.to).getDate()} ${MONTHS_GEN[fromKey(brk.to).getMonth()]}</small></div><button class="bk-end" data-break-open>Zmień</button></div>` + html;
    html += onList.map(rowHtml).join('');
    if (offList.length) html += (onList.length ? `<div class="grp sep" data-fk="g:off-sep"></div>` : '') + offList.map(rowHtml).join('');
    if (later.length) html += `<div class="grp later" data-fk="g:later">Dodane później</div>` + later.map(rowHtml).join('');
    if (mobile && skipped.length) html += `<div class="grp later" data-fk="g:sk">Odpuszczone</div>` + skipped.map(skRowHtml).join('');
    const vw = $('view-week'), listEl = $('list');
    // „Dzień dobry”: przy pierwszym otwarciu danego dnia kafelki wjeżdżają z odbiciem, zaległe migają swoim kolorem
    let hello = false;
    if (view === 'week' && !$('app-main').hidden) { try { hello = localStorage.getItem('hbtrack.hello') !== t; if (hello) localStorage.setItem('hbtrack.hello', t); } catch (_) { } }
    vw.classList.remove('slide-l', 'slide-r'); listEl.classList.remove('enter', 'hello');
    if (slideDir || animList || hello) void vw.offsetWidth; // wymusza restart animacji
    if (hello) listEl.classList.add('hello'); else if (slideDir) vw.classList.add(slideDir > 0 ? 'slide-l' : 'slide-r'); else if (animList) listEl.classList.add('enter');
    listEl.innerHTML = html;
    afterList(listEl);
    animList = false; slideDir = 0; justCell = null;
    renderTimerCard();

    function odRowHtml({ h, d, k, age }) {
      const idx = rowIdx++, s = status(h, d), v = getVal(h, k), yKey = k, when = age === 2 ? 'przedwczoraj' : 'wczoraj';
      const sub = h.type === 'num' ? `${v == null ? 0 : nf(v)} / ${nf(h.target)} ${esc(h.unit)}` : 'nie zrobione';
      return `<div class="o-row od${age === 2 ? ' old' : ''}" data-fk="od:${h.id}|${k}" style="--i:${idx}"><div class="name"><div class="nt"><b><span class="nm">${esc(h.name)}</span><span class="odtag">z ${when}</span></b><small>${sub}</small></div></div><div class="o-track"><button class="ob ${s}" data-h="${h.id}" data-k="${yKey}" data-od aria-label="Nadrób: ${esc(h.name)}, ${when}"><span class="c ${s}"${h.type === 'num' ? ` data-lv="${h.id}|${k}"` : ''} style="--p:${pct(prog(h, v))};--lv:${waterLevel(prog(h, v))}">${s === 'part' ? WATER : ''}</span></button></div><div class="rmenu"><button class="dots odx" data-skip="${h.id}|${yKey}" aria-label="Odpuść: ${esc(h.name)}">${XMARK}</button></div></div>`;
    }
    function skRowHtml({ h, k, age }) {
      const idx = rowIdx++, when = age === 2 ? 'przedwczoraj' : 'wczoraj';
      return `<div class="o-row od sk${age === 2 ? ' old' : ''}" data-fk="od:${h.id}|${k}" style="--i:${idx}"><div class="name"><div class="nt"><b><span class="nm">${esc(h.name)}</span><span class="odtag">z ${when}</span></b></div></div><div class="o-track"></div><div class="rmenu"><button class="dots odr" data-unskip="${h.id}|${k}" aria-label="Przywróć: ${esc(h.name)}, ${when}">${UNDO}</button></div></div>`;
    }
    function rowHtml(h) {
      const idx = rowIdx++;
      const cells = shown.map((d, i) => {
        const s = status(h, d), v = getVal(h, key(d));
        // łańcuch: zrobiony dzień połączony linią z zrobionym następnym; nowe ogniwo dorysowuje się od strony świeżo odhaczonego dnia
        const nd = !mobile && s === 'done' && shown[i + 1] && status(h, shown[i + 1]) === 'done' ? shown[i + 1] : null;
        const lnc = !nd ? '' : ' ln' + (justCell?.h === h.id ? justCell.k === key(d) ? ' ln-r' : justCell.k === key(nd) ? ' ln-l' : '' : '');
        const dis = s === 'future' || s === 'off' || s === 'pre' || s === 'rest';
        const lbl = `${h.name}, ${DAYS_FULL[dow(d)]} ${d.getDate()}: ${s === 'rest' ? 'przerwa' : s === 'off' ? 'poza planem' : s === 'pre' ? 'przed dodaniem' : s === 'future' ? 'przyszłość' : v == null ? 'brak wpisu' : fmt(h, v) + ' ' + (h.unit || '')}`;
        // nawyk-timer: zamiast kółka sam zegar (pierścień = postęp, kręcące się wskazówki = odlicza)
        if (h.clock) return `<button class="ob ck ${s} ${key(d) === t ? 'today' : ''}${lnc}" data-h="${h.id}" data-k="${key(d)}" data-clock ${dis ? 'disabled' : ''} aria-label="${esc(lbl)}"><span class="c ck ${s}${justCell && justCell.h === h.id && justCell.k === key(d) ? ' just' : ''}${timer && timer.hid === h.id && timer.k === key(d) ? ' run' : ''}" style="--p:${pct(prog(h, v))}">${CLOCK}</span></button>`;
        return `<button class="ob ${s} ${key(d) === t ? 'today' : ''}${lnc}" data-h="${h.id}" data-k="${key(d)}" ${dis ? 'disabled' : ''} aria-label="${esc(lbl)}"><span class="c ${s}${justCell && justCell.h === h.id && justCell.k === key(d) ? ' just' : ''}"${h.type === 'num' ? ` data-lv="${h.id}|${key(d)}"` : ''} style="--p:${pct(prog(h, v))};--lv:${waterLevel(prog(h, v))}">${s === 'done' ? CHECK : s === 'part' ? WATER : ''}</span></button>`;
      }).join('');
      const open = rowMenu === h.id;
      const acts = open
        ? `<div class="racts"><button class="ra edit" data-edit="${h.id}" aria-label="Edytuj ${esc(h.name)}">${PENCIL}</button><button class="ra del" data-del="${h.id}" aria-label="Usuń ${esc(h.name)}">${XMARK}</button></div>`
        : `<button class="dots" data-more="${h.id}" aria-label="Opcje: ${esc(h.name)}" aria-expanded="false">${DOTS}</button>`;
      // telefon: pod nazwą wpisana wartość dnia zamiast opisu celu; nawyk bez planu na ten dzień jest przygaszony
      let sub = tgt(h), off = false;
      if (mobile) {
        const s = status(h, selDay), v = getVal(h, key(selDay));
        off = s === 'off' || s === 'pre' || s === 'rest';
        if (s === 'off') sub = 'nie dziś';
        else if (s === 'rest') sub = 'przerwa';
        else if (h.freq) sub = `${weekDone(h, selDay, false)} / ${h.freq} w tym tygodniu`;
        else if (h.type === 'num') sub = `${v == null ? 0 : nf(v)} / ${nf(h.target)} ${esc(h.unit)}`;
      }
      // licznik czasu: dla nawyków w minutach/godzinach, na dziś, dopóki cel nie jest zrobiony
      const tk = todayKey(), canTime = timeUnit(h) && (mobile ? key(selDay) === tk : true) && !['done', 'off', 'rest'].includes(status(h, fromKey(tk)));
      const running = timer && timer.hid === h.id;
      const odTag = mobile ? '' : overdue.filter(o => o.h === h).map(o => `<span class="odtag${o.age === 2 ? ' old' : ''}">${o.age === 2 ? 'przedwczoraj' : 'wczoraj'}</span>`).join('');
      const tbtn = '';
      if (running) sub = `<span data-timer-left>${fmtLeft(timerLeft())}</span> pozostało`;
      else if (canTime && h.type === 'bool' && spentOf(h, tk) > 0) sub = `${fmtLeft(timerNeed(h, tk))} pozostało`;
      const sk = streak(h);
      const tl = TIMES.find(([v]) => v === h.time)?.[1];
      const tod = tl ? `<span class="tod">${tl}</span>` : '';
      // płomień rośnie na progach 7 / 14 / 30 dni; w dniu przekroczenia progu rozbłyska
      const tier = sk >= 30 ? 3 : sk >= 14 ? 2 : sk >= 7 ? 1 : 0;
      const fresh = justCell && justCell.h === h.id && status(h, fromKey(justCell.k)) === 'done';
      const rec = fresh && sk >= 3 && sk > bestStreak(h).prior;
      if (rec) recordToast = `Nowy rekord serii: ${sk}`;
      const flare = fresh && ([7, 14, 30].includes(sk) || rec);
      const fire = sk >= 2 ? `<span class="streak${tier ? ' t' + tier : ''}${flare ? ' flare' : ''}" aria-label="Seria: ${sk}">${FLAME}${sk}</span>` : '';
      return `<div class="o-row${open ? ' menu-open' : ''}${off ? ' is-off' : ''}" data-id="${h.id}" data-fk="h:${h.id}" style="--i:${idx}"><div class="name"><button class="grip" aria-label="Przenieś ${esc(h.name)}">${GRIP}</button><div class="nt"><b><span class="nm">${esc(h.name)}</span>${odTag}${tod}${fire}</b><small>${sub}</small></div>${tbtn}</div><div class="o-track">${cells}</div><div class="rmenu">${acts}</div></div>`;
    }
  }

  // Zmiana dnia: podświetlenie i widok przechodzą same na nowy dzień (także o północy przy otwartej aplikacji).
  let lastToday = todayKey();
  function checkDayChange() {
    const now = todayKey();
    if (now === lastToday) return false;
    const prev = fromKey(lastToday);
    if (key(weekStart) === key(startOfWeek(prev))) weekStart = startOfWeek(new Date());
    if (key(selDay) === lastToday) selDay = dayOnly(new Date());
    if (key(monthStart) === key(monthOf(prev))) monthStart = monthOf(new Date());
    if (key(mealDay) === lastToday) mealDay = dayOnly(new Date());
    lastToday = now;
    render();
    return true;
  }
  function scheduleMidnight() {
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    setTimeout(() => { checkDayChange(); scheduleMidnight(); }, next - now);
  }

  /* ---------- modale ---------- */
  const overlay = $('overlay');
  let noteOpen = false;
  const close = () => {
    overlay.innerHTML = ''; edit = null;
    if (partyLater) { partyLater = false; setTimeout(celebrate, 120); }
    if (noteOpen) { noteOpen = false; render(); }
  };
  const sheet = (title, sub, body, label) => `<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || title)}"><div class="sheet-h"><div><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ''}</div><button class="x" data-close aria-label="Zamknij">×</button></div>${body}</div></div>`;
  const dateLabel = k => { const d = fromKey(k); return `${DAYS_FULL[dow(d)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };

  function openEditor(hid, k) { edit = { hid, k }; drawEditor(); }
  function openNote(k) {
    noteOpen = true;
    overlay.innerHTML = sheet(dateLabel(k), '', `<textarea id="note-text" maxlength="140" rows="3" placeholder="Notatka">${esc(noteOf(k))}</textarea><button class="primary" data-close>Gotowe</button>`, 'Notatka');
    const ta = $('note-text');
    ta.addEventListener('input', () => setNote(k, ta.value));
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function drawEditor() {
    const h = state.habits.find(x => x.id === edit.hid), k = edit.k, v = getVal(h, k);
    let body;
    if (h.type === 'num') {
      const p = prog(h, v);
      const w = v => Math.max(1, String(v ?? '').length); // szerokość pola = liczba znaków, żeby jednostka stała tuż za liczbą
      body = `<div class="ed-val"><button data-ed="-" aria-label="Mniej">−</button><label class="ed-num" for="ed-input"><input id="ed-input" type="number" inputmode="decimal" step="${h.step}" min="0" value="${v || ''}" placeholder="0" aria-label="Wartość" style="width:${w(v || '')}ch">${h.unit ? `<span class="ed-u">${esc(h.unit)}</span>` : ''}</label><button data-ed="+" aria-label="Więcej">+</button></div><div class="prog"><i class="${p >= 1 ? 'full' : ''}" style="width:${p * 100}%"></i></div><div class="chips"><button data-ed="target">Cel: ${nf(h.target)}${h.unit ? ' ' + esc(h.unit) : ''}</button></div>`;
    } else {
      body = `<div class="yn"><button data-ed="yes" class="${v === 1 ? 'sel-done' : ''}">Zrobione</button><button data-ed="no" class="${v === 0 ? 'sel-miss' : ''}">Nie zrobione</button></div><div class="chips"><button data-ed="clear">Wyczyść wpis</button></div>`;
    }
    overlay.innerHTML = sheet(esc(h.name), dateLabel(k), body + `<button class="primary" data-close>Gotowe</button>`, 'Edycja wpisu');
    const inp = $('ed-input');
    if (inp) {
      inp.addEventListener('input', () => {
        // bez zer na początku: „07” → „7”; samo zero zostaje, ale na szaro
        const clean = inp.value.replace(/^0+(?=\d)/, '');
        if (clean !== inp.value) inp.value = clean;
        inp.classList.toggle('zero', !(parseFloat(inp.value.replace(',', '.')) > 0));
        inp.style.width = Math.max(1, inp.value.length) + 'ch';
        const n = parseFloat(inp.value.replace(',', '.'));
        setVal(h, k, isNaN(n) ? null : Math.max(0, n)); render();
        syncEditor(h, k, false);
      });
    }
  }
  // Odświeża otwarty edytor w miejscu (liczba, szerokość pola, pasek), bez przebudowy okienka.
  function syncEditor(h, k, setInput = true) {
    const v = getVal(h, k), inp = $('ed-input'), bar = overlay.querySelector('.prog i');
    if (inp && setInput) { inp.value = v || ''; inp.style.width = Math.max(1, String(v || '').length) + 'ch'; inp.classList.remove('zero'); }
    if (bar) { const p = prog(h, v); bar.style.width = p * 100 + '%'; bar.classList.toggle('full', p >= 1); }
  }
  overlay.addEventListener('click', e => {
    if (e.target.hasAttribute('data-close')) { close(); return; }
    const b = e.target.closest('[data-ed]'); if (!b || !edit) return;
    const h = state.habits.find(x => x.id === edit.hid), k = edit.k, a = b.dataset.ed, v = getVal(h, k) || 0;
    const map = { '+': +(v + h.step).toFixed(2), '-': Math.max(0, +(v - h.step).toFixed(2)), clear: null, target: h.target, yes: 1, no: 0 };
    setVal(h, k, map[a]);
    if (h.type === 'bool') { justCell = { h: h.id, k }; render(); if (a !== 'clear') close(); else drawEditor(); return; }
    render();
    syncEditor(h, k);
  });

  function openHabitForm(hid) {
    const h = hid ? state.habits.find(x => x.id === hid) : null;
    const days = h ? h.days : [];
    const body = `<form id="hform">
      <div class="field"><label for="f-name">Nazwa</label><input id="f-name" type="text" required maxlength="30" value="${h ? esc(h.name) : ''}"></div>
      <div class="field"><span class="lab">Rodzaj</span><div class="seg seg3"><label><input type="radio" name="f-type" id="f-type-bool" value="bool" ${!h || h.type === 'bool' ? 'checked' : ''}><span>Tak / nie</span></label><label><input type="radio" name="f-type" id="f-type-num" value="num" ${h && h.type === 'num' && !h.clock ? 'checked' : ''}><span>Liczbowy</span></label><label><input type="radio" name="f-type" id="f-type-timer" value="timer" ${h?.clock ? 'checked' : ''}><span>Timer</span></label></div></div>
      <div class="row3" id="f-numfields"><div class="field"><label for="f-target">Cel dzienny</label><input id="f-target" type="number" min="0.01" step="any" value="${h?.target ?? ''}"></div><div class="field"><label for="f-unit">Jednostka</label><input id="f-unit" type="text" value="${h ? esc(h.unit) : ''}" maxlength="10"></div><div class="field"><label for="f-step">Krok +/−</label><input id="f-step" type="number" min="0.01" step="any" value="${h?.step ?? 1}"></div></div>
      <div class="field" id="f-minfield"><label for="f-min">Minut dziennie</label><input id="f-min" type="number" min="1" step="1" inputmode="numeric" value="${h?.clock ? h.target : ''}"></div>
      <div class="field"><span class="lab">Plan</span><div class="seg"><label><input type="radio" name="f-plan" value="days" ${!h?.freq ? 'checked' : ''}><span>Wybrane dni</span></label><label><input type="radio" name="f-plan" value="freq" ${h?.freq ? 'checked' : ''}><span>X razy w tygodniu</span></label></div></div>
      <div class="field" id="f-freqfield"><div class="seg seg6">${[1, 2, 3, 4, 5, 6].map(n => `<label><input type="radio" name="f-freq" value="${n}" ${(h?.freq || 3) === n ? 'checked' : ''}><span>${n}×</span></label>`).join('')}</div></div>
      <div class="field" id="f-daysfield"><div class="daypick" role="group" aria-label="Dni nawyku">${DAYS.map((d, i) => `<label><input type="checkbox" id="f-d${i}" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div><button type="button" class="allweek" id="f-all">Cały tydzień</button></div>
      <div class="field"><span class="lab">Pora</span><div class="seg seg4">${[['', '—'], ...TIMES].map(([v, l]) => `<label><input type="radio" name="f-time" id="f-time-${v || 'any'}" value="${v}" ${(h?.time || '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <button class="primary" type="submit">${h ? 'Zapisz' : 'Dodaj'}</button>
      ${h ? `<button class="danger" type="button" id="f-delete">Usuń nawyk</button>` : ''}
    </form>`;
    overlay.innerHTML = sheet(h ? 'Edytuj nawyk' : 'Nowy nawyk', '', body);
    const f = $('hform');
    const sync = () => {
      const tp = f.querySelector('input[name="f-type"]:checked').value;
      $('f-numfields').hidden = tp !== 'num';
      $('f-minfield').hidden = tp !== 'timer';
      const freq = f.querySelector('input[name="f-plan"]:checked').value === 'freq';
      $('f-freqfield').hidden = !freq; $('f-daysfield').hidden = freq;
    };
    f.querySelectorAll('input[name="f-type"], input[name="f-plan"]').forEach(r => r.addEventListener('change', sync)); sync();
    f.style.display = 'flex'; f.style.flexDirection = 'column'; f.style.gap = '16px';
    $('f-all').addEventListener('click', () => f.querySelectorAll('.daypick input').forEach(x => { x.checked = true; }));
    f.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('f-name').value.trim(); if (!name) return;
      const kind = f.querySelector('input[name="f-type"]:checked').value, isTimer = kind === 'timer', type = isTimer ? 'num' : kind;
      const mins = parseFloat($('f-min').value);
      if (isTimer && !(mins > 0)) { toast('Podaj minuty'); $('f-min').focus(); return; }
      const freqOn = f.querySelector('input[name="f-plan"]:checked').value === 'freq';
      const freq = freqOn ? +f.querySelector('input[name="f-freq"]:checked').value : 0;
      const sel = freqOn ? [...ALL] : [...f.querySelectorAll('.daypick input:checked')].map(x => +x.value);
      if (!sel.length) { toast('Wybierz przynajmniej jeden dzień'); return; }
      const rawTarget = parseFloat($('f-target').value);
      if (kind === 'num' && !(rawTarget > 0)) { toast('Podaj cel dzienny'); $('f-target').focus(); return; }
      const target = Math.max(0.01, rawTarget || 1);
      const step = Math.max(0.01, parseFloat($('f-step').value) || 1);
      const unit = $('f-unit').value.trim();
      const time = f.querySelector('input[name="f-time"]:checked')?.value || '';
      // nawyk obowiązuje od dnia dodania; wcześniejsze dni pokazują „?”
      const target_ = h || { id: 'h' + Date.now().toString(36), created: todayKey() };
      Object.assign(target_, isTimer ? { name, type, target: Math.round(mins), step: 5, unit: 'min', days: sel, timer: 'min', clock: true } : { name, type, target, step, unit, days: sel, timer: '' });
      if (!isTimer) delete target_.clock;
      delete target_.dur;
      if (freq) target_.freq = freq; else delete target_.freq;
      if (time) target_.time = time; else delete target_.time;
      if (!h) state.habits.push(target_);
      save(); close(); render(); toast(h ? 'Zapisano' : `Dodano „${name}”`);
    });
    const del = $('f-delete');
    if (del) del.addEventListener('click', () => confirmDelete(h.id));
    $('f-name').focus();
  }

  function confirmDelete(hid) {
    const h = state.habits.find(x => x.id === hid); if (!h) return;
    overlay.innerHTML = sheet('Usunąć nawyk?', esc(h.name), `<div class="confirm"><button data-close>Anuluj</button><button class="yes" id="confirm-del">Usuń</button></div>`);
    $('confirm-del').addEventListener('click', () => { state.habits = state.habits.filter(x => x.id !== h.id); delete state.entries[h.id]; Object.keys(state.skips).forEach(k => { if (k.startsWith(h.id + '|')) delete state.skips[k]; }); save(); close(); render(); });
  }

  /* ---------- ekran logowania: bez konta nie ma panelu ---------- */
  let authMode = 'in';
  function setAuthMode(m) {
    authMode = m;
    document.querySelectorAll('[data-auth]').forEach(b => b.setAttribute('aria-selected', b.dataset.auth === m));
    $('a-pass2-row').hidden = m !== 'up';
    $('a-pass').setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
    $('a-submit').textContent = m === 'up' ? 'Załóż konto' : 'Zaloguj się';
    showAuthError('');
  }
  function showAuthError(msg) { const el = $('auth-err'); el.textContent = msg; el.hidden = !msg; }
  // Pokazuje ekran logowania albo panel, zależnie od tego, czy jest zalogowane konto.
  function updateGate() {
    const logged = !!window.Cloud?.user || !window.Cloud;
    $('auth').hidden = logged;
    $('app-main').hidden = !logged;
    if (!logged) { close(); if (!document.activeElement?.closest('#auth')) $('a-email').focus(); }
  }
  function authError(err) {
    const m = (err?.message || '').toLowerCase(), c = err?.code || '';
    if (err instanceof TypeError || m.includes('failed to fetch')) return 'Brak połączenia z internetem';
    if (err?.status === 429 || c === 'over_request_rate_limit' || m.includes('rate')) return 'Za dużo prób — spróbuj za kilka minut';
    if (c === 'invalid_credentials' || m.includes('invalid login')) return 'Zły e-mail lub hasło';
    if (c === 'user_already_exists' || m.includes('already registered')) return 'To konto już istnieje — zaloguj się';
    if (c === 'weak_password' || m.includes('password')) return 'Hasło musi mieć co najmniej 6 znaków';
    if (c === 'email_address_invalid' || m.includes('email')) return 'Sprawdź adres e-mail';
    return 'Nie udało się: ' + (err?.message || 'nieznany błąd');
  }
  document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));
  $('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('a-email').value.trim(), pass = $('a-pass').value, pass2 = $('a-pass2').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showAuthError('Sprawdź adres e-mail');
    if (pass.length < 6) return showAuthError('Hasło musi mieć co najmniej 6 znaków');
    if (authMode === 'up' && pass !== pass2) return showAuthError('Hasła nie są takie same');
    const btn = $('a-submit'), label = btn.textContent;
    btn.disabled = true; btn.textContent = '…'; showAuthError('');
    try {
      if (authMode === 'up') await window.Cloud.signUp(email, pass); else await window.Cloud.signIn(email, pass);
      // zapamiętanie e-maila i hasła w menedżerze haseł (Chrome/Android pyta o zapis; Safari rozpoznaje znikający formularz)
      try { if (window.PasswordCredential) await navigator.credentials.store(new PasswordCredential({ id: email, password: pass, name: email })); } catch (_) { }
      updateGate(); render();
      setTimeout(() => { $('auth-form').reset(); setAuthMode('in'); }, 1500);
    } catch (err) { showAuthError(authError(err)); }
    finally { btn.disabled = false; btn.textContent = label === '…' ? 'Zaloguj się' : label; }
  });
  // Wylogowanie: najpierw wysyła zmiany, potem czyści dane z urządzenia i wraca do ekranu logowania.
  // ⋯ w prawym górnym rogu: konto (e-mail) i wylogowanie.
  // Komputer: ⋯ = konto (e-mail) i wylogowanie. Telefon: ☰ = Tydzień, Kalendarz, Wyloguj się.
  $('menu-btn').addEventListener('click', () => {
    if (isMobile()) {
      const item = (v, label) => `<button class="nav-item${view === v ? ' on' : ''}" data-go-view="${v}">${label}</button>`;
      overlay.innerHTML = sheet('Menu', '', `<nav class="navmenu">${item('week', 'Tydzień')}${item('calendar', 'Kalendarz')}${item('summary', 'Podsumowanie')}${item('meals', 'Posiłki')}<button class="nav-item" data-break-open>Przerwa</button><button class="nav-item out" id="logout">Wyloguj się</button></nav>`, 'Menu');
      overlay.querySelectorAll('[data-go-view]').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.goView;
        if (v === 'calendar' && view !== 'calendar') monthStart = monthOf(selDay);
        close(); setView(v); window.scrollTo({ top: 0 });
      }));
    } else {
      overlay.innerHTML = sheet(esc(window.Cloud?.user?.email || 'Konto'), '', `<button class="nav-item" data-break-open>Przerwa</button><button class="primary" id="logout">Wyloguj</button>`, 'Konto');
    }
    $('logout').addEventListener('click', confirmLogout);
  });
  // Przerwa (urlop, choroba): od–do. W tym czasie nawyki się nie liczą, seria się nie zrywa, nie ma zaległości.
  function openBreak() {
    const t = todayKey();
    const lbl = k => { const d = fromKey(k); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
    const upcoming = Object.entries(state.breaks).filter(([, b]) => b.to >= t).sort((a, b) => a[1].from.localeCompare(b[1].from));
    const items = upcoming.map(([id, b]) => {
      const now = b.from <= t;
      return `<div class="brk-item${now ? ' now' : ''}"><span>${lbl(b.from)} – ${lbl(b.to)}</span>${now
        ? `<button class="end" data-brk-end="${id}">Zakończ</button>`
        : `<button class="dots" data-brk-del="${id}" aria-label="Usuń przerwę">${XMARK}</button>`}</div>`;
    }).join('');
    overlay.innerHTML = sheet('Przerwa', '', `${items ? `<div class="brk-list">${items}</div>` : ''}
      <div class="row2"><div class="field"><label for="b-from">Od</label><input id="b-from" type="date" value="${t}"></div><div class="field"><label for="b-to">Do</label><input id="b-to" type="date" value="${key(addDays(fromKey(t), 6))}"></div></div>
      <div class="bk-quick">${[[3, '3 dni'], [7, 'Tydzień'], [14, '2 tygodnie']].map(([n, l]) => `<button type="button" class="allweek" data-brk-len="${n}">${l}</button>`).join('')}</div>
      <button class="primary" id="b-save">Zacznij przerwę</button>`, 'Przerwa');
    const done = () => { save(); close(); animList = true; render(); };
    overlay.querySelectorAll('[data-brk-len]').forEach(b => b.addEventListener('click', () => {
      const from = $('b-from').value || t;
      $('b-to').value = key(addDays(fromKey(from), +b.dataset.brkLen - 1));
    }));
    overlay.querySelectorAll('[data-brk-del]').forEach(b => b.addEventListener('click', () => { delete state.breaks[b.dataset.brkDel]; done(); }));
    // zakończenie trwającej przerwy: minione dni zostają wolne, od dziś nawyki znów się liczą
    overlay.querySelectorAll('[data-brk-end]').forEach(b => b.addEventListener('click', () => {
      const br = state.breaks[b.dataset.brkEnd], y = key(addDays(fromKey(t), -1));
      if (br.from > y) delete state.breaks[b.dataset.brkEnd]; else state.breaks[b.dataset.brkEnd] = { ...br, to: y };
      done();
    }));
    $('b-save').addEventListener('click', () => {
      const from = $('b-from').value, to = $('b-to').value;
      if (!from || !to || to < from) { toast('Sprawdź daty'); return; }
      state.breaks['b' + Date.now().toString(36)] = { from, to };
      done();
    });
  }
  function confirmLogout() {
    overlay.innerHTML = sheet('Czy chcesz się wylogować?', '', `<div class="confirm"><button data-close>Nie</button><button class="yes" id="confirm-logout">Tak</button></div>`);
    $('confirm-logout').addEventListener('click', async () => {
      const b = $('confirm-logout'); b.disabled = true;
      try {
        await window.Cloud.signOut();
        close();
        applyState({ habits: [], entries: {}, notes: {} });
        updateGate();
      } catch (err) { close(); toast(err.message); }
    });
  }

  /* ---------- posiłki: własne przepisy z makro, dziennik dnia, zapotrzebowanie ---------- */
  // Makro składnika podaje się na 100 g (jak na opakowaniu); kalorie liczą się same: białko i węgle 4 kcal/g, tłuszcz 9 kcal/g.
  let mealDay = dayOnly(new Date()), justFood = null;
  const dockPrev = new Map(); // poprzednie szerokości pasków w liczniku, żeby płynnie przesunąć do nowych
  const kcalOf = m => Math.round(m.p * 4 + m.c * 4 + m.f * 9);
  const r1 = v => Math.round(v * 10) / 10;
  const n0 = v => Math.round(v).toLocaleString('pl-PL');
  const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x > 0 ? x : 0; };
  function mealTotals(items) {
    const s = { g: 0, p: 0, c: 0, f: 0 };
    items.forEach(it => { const k = it.g / 100; s.g += it.g; s.p += it.p * k; s.c += it.c * k; s.f += it.f * k; });
    return { g: Math.round(s.g), p: r1(s.p), c: r1(s.c), f: r1(s.f) };
  }
  const dayFood = k => Object.entries(state.food[k] || {}).map(([id, e]) => ({ id, ...e })).sort((a, b) => a.t - b.t);
  const portion = e => ({ p: e.p * e.x, c: e.c * e.x, f: e.f * e.x });
  function eatenOn(k) {
    const s = { p: 0, c: 0, f: 0 };
    dayFood(k).forEach(e => { const q = portion(e); s.p += q.p; s.c += q.c; s.f += q.f; });
    return { ...s, kcal: kcalOf(s) };
  }
  const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const CAMERA = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.6"/></svg>';
  const thumb = (m, name) => m?.photo ? `<img class="mthumb" src="${m.photo}" alt="">` : `<span class="mthumb ph" aria-hidden="true">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
  const macLine = m => `<span class="ml"><i class="k-p">B ${n0(m.p)}</i><i class="k-c">W ${n0(m.c)}</i><i class="k-f">T ${n0(m.f)}</i></span>`;
  const tiles = m => `<div class="mtiles"><div><small>kcal</small><b>${n0(kcalOf(m))}</b></div><div class="k-p"><small>Białko</small><b>${nf(r1(m.p))} g</b></div><div class="k-c"><small>Węgle</small><b>${nf(r1(m.c))} g</b></div><div class="k-f"><small>Tłuszcz</small><b>${nf(r1(m.f))} g</b></div></div>`;
  const mealDayLabel = () => { const k = key(mealDay), t = todayKey(); return k === t ? 'Dziś' : k === key(addDays(fromKey(t), -1)) ? 'Wczoraj' : DAYS_FULL[dow(mealDay)]; };

  function renderMeals() {
    const k = key(mealDay), log = dayFood(k), enter = animList ? ' enter' : '';
    // biblioteka: ostatnio jedzone na górze, potem najnowsze
    const lastUse = {};
    Object.values(state.food).forEach(d => Object.values(d).forEach(e => { if ((lastUse[e.mid] || 0) < e.t) lastUse[e.mid] = e.t; }));
    const lib = Object.entries(state.meals).map(([id, m]) => ({ id, ...m })).sort((a, b) => (lastUse[b.id] || 0) - (lastUse[a.id] || 0) || (b.created || 0) - (a.created || 0));
    let html = `<div class="snav mnav">${navBtn(-1)}<b>${mealDayLabel()}<em>, ${mealDay.getDate()} ${MONTHS_GEN[mealDay.getMonth()]}</em></b>${navBtn(1)}</div>`;
    html += `<div class="grp later">Zjedzone</div>`;
    html += log.length
      ? `<div class="mlist${enter}">${log.map((e, i) => { const q = portion(e); return `<button class="mrow${e.id === justFood ? ' just' : ''}" data-food="${e.id}" style="--i:${i}">${thumb(state.meals[e.mid], e.name)}<span class="mt"><b><span class="nm">${esc(e.name)}</span>${e.x !== 1 ? `<span class="por">×${nf(e.x)}</span>` : ''}</b>${macLine(q)}</span><span class="mk"><b>${n0(kcalOf(q))}</b><small>kcal</small></span></button>`; }).join('')}</div>`
      : `<p class="mempty">Nic jeszcze nie dodano${lib.length ? ' — kliknij + przy posiłku poniżej' : ''}.</p>`;
    html += `<div class="mhead"><div class="grp later">Moje posiłki</div>${lib.length ? `<button class="mnew" data-meal-new>${PLUS} Nowy posiłek</button>` : ''}</div>`;
    html += lib.length
      ? `<div class="mlist${enter}">${lib.map((m, i) => { const tt = mealTotals(m.items); return `<div class="mrow lib" style="--i:${i + log.length}"><button class="mopen" data-meal="${m.id}">${thumb(m, m.name)}<span class="mt"><b><span class="nm">${esc(m.name)}</span></b>${macLine(tt)}</span><span class="mk"><b>${n0(kcalOf(tt))}</b><small>kcal</small></span></button><button class="madd" data-meal-log="${m.id}" aria-label="Dodaj ${esc(m.name)} do dnia"><span>${PLUS}</span></button></div>`; }).join('')}</div>`
      : `<div class="mempty big"><b>Stwórz pierwszy posiłek</b><span>Nazwa, składniki z gramaturą i makro — kalorie policzą się same.</span><button class="primary" data-meal-new>Nowy posiłek</button></div>`;
    $('view-meals').innerHTML = html;
    renderDock();
    animList = false; justFood = null;
  }

  // Licznik na dole: zjedzone kcal i makro dnia względem zapotrzebowania.
  function renderDock() {
    const e = eatenOn(key(mealDay)), g = state.goals;
    const w = (v, max) => max ? Math.min(100, v / max * 100) : 0;
    const bar = (id, v, max) => `<div class="mbar"><i data-w="${id}" style="width:${dockPrev.get(id) ?? 0}%" data-to="${w(v, max)}"></i></div>`;
    const mc = (id, lbl, v, max) => `<div class="mc k-${id}${max && v > max * 1.05 ? ' over' : ''}"><span class="lb">${lbl}</span><span class="vl"><b>${n0(v)}</b>${max ? ` / ${n0(max)}` : ''} g</span>${max ? bar(id, v, max) : ''}</div>`;
    const over = g?.kcal && e.kcal > g.kcal;
    $('meal-dock').innerHTML = `<div class="dk-k${over ? ' over' : ''}"><span class="lb">Zjedzone</span><span class="vl"><b>${n0(e.kcal)}</b>${g?.kcal ? ` / ${n0(g.kcal)}` : ''} kcal</span>${g?.kcal ? bar('k', e.kcal, g.kcal) : '<small class="dk-set">Ustaw zapotrzebowanie ›</small>'}</div><div class="dk-m">${mc('p', 'Białko', e.p, g?.p)}${mc('c', 'Węgle', e.c, g?.c)}${mc('f', 'Tłuszcz', e.f, g?.f)}</div>`;
    const bars = $('meal-dock').querySelectorAll('[data-to]');
    void $('meal-dock').offsetWidth;
    bars.forEach(i => { i.style.width = i.dataset.to + '%'; dockPrev.set(i.dataset.w, +i.dataset.to); });
  }

  function logMeal(mid, x) {
    const m = state.meals[mid]; if (!m) return;
    const tt = mealTotals(m.items), k = key(mealDay), id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    (state.food[k] ??= {})[id] = { mid, name: m.name, p: tt.p, c: tt.c, f: tt.f, x, t: Date.now() };
    justFood = id; save(); render();
    if (!calm()) $('meal-dock').animate({ transform: ['scale(1)', 'scale(1.025)', 'scale(1)'] }, { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    toast(`Dodano: ${m.name}`);
  }

  // Liczba porcji: − / + co pół porcji, można też wpisać (np. 0,3).
  const portionHtml = x => `<div class="ed-val pz"><button type="button" data-pz="-1" aria-label="Mniej">−</button><div class="ed-num"><span class="ed-u">×</span><input id="pz" type="text" inputmode="decimal" value="${nf(x)}" aria-label="Porcje" autocomplete="off"></div><button type="button" data-pz="1" aria-label="Więcej">+</button></div>`;
  function bindPortion(x, cb) {
    const inp = $('pz');
    const set = v => { x = v; inp.value = nf(x); cb(x); };
    overlay.querySelectorAll('[data-pz]').forEach(b => b.addEventListener('click', () => set(Math.max(0.5, Math.round((x + 0.5 * +b.dataset.pz) * 2) / 2))));
    inp.addEventListener('input', () => { const v = num(inp.value); if (v) { x = v; cb(x); } });
    inp.addEventListener('blur', () => { inp.value = nf(x); });
    cb(x);
    return () => x;
  }
  const afterLine = extra => { const e = eatenOn(key(mealDay)), gk = state.goals?.kcal, v = e.kcal + extra; return `Po dodaniu: <b class="${gk && v > gk ? 'over' : ''}">${n0(v)}</b>${gk ? ` / ${n0(gk)}` : ''} kcal`; };

  // Szczegóły posiłku: zdjęcie, makro, składniki; dodanie do dnia z liczbą porcji.
  function openMeal(id) {
    const m = state.meals[id]; if (!m) return;
    const tt = mealTotals(m.items), kc = kcalOf(tt);
    const when = mealDayLabel() === 'Dziś' ? 'Dodaj do dziś' : `Dodaj — ${mealDay.getDate()} ${MONTHS_GEN[mealDay.getMonth()]}`;
    overlay.innerHTML = sheet(esc(m.name), `${n0(tt.g)} g · ${n0(kc)} kcal`, `${m.photo ? `<img class="md-photo" src="${m.photo}" alt="">` : ''}
      <div id="md-tiles">${tiles(tt)}</div>
      <div class="mingr">${m.items.map(it => { const q = { p: it.p * it.g / 100, c: it.c * it.g / 100, f: it.f * it.g / 100 }; return `<div><span>${esc(it.n || 'Składnik')}</span><em>${nf(it.g)} g</em><b>${n0(kcalOf(q))} kcal</b></div>`; }).join('')}</div>
      <div class="md-log">${portionHtml(1)}<small class="md-after" id="md-after"></small><button class="primary" id="md-log">${when}</button></div>
      <div class="md-acts"><button id="md-edit">${PENCIL} Edytuj</button><button class="del" id="md-del">${XMARK} Usuń</button></div>`, 'Posiłek');
    const x = bindPortion(1, v => {
      const q = { p: tt.p * v, c: tt.c * v, f: tt.f * v };
      $('md-tiles').innerHTML = tiles(q);
      $('md-after').innerHTML = afterLine(kcalOf(q));
    });
    $('md-log').addEventListener('click', () => { const v = x(); close(); logMeal(id, v); });
    $('md-edit').addEventListener('click', () => openMealForm(id));
    $('md-del').addEventListener('click', () => {
      overlay.innerHTML = sheet('Usunąć posiłek?', esc(m.name), `<p class="g-hint">Wpisy w dziennikach zostaną.</p><div class="confirm"><button data-close>Anuluj</button><button class="yes" id="confirm-del">Usuń</button></div>`);
      $('confirm-del').addEventListener('click', () => { delete state.meals[id]; save(); close(); render(); });
    });
  }

  // Wpis w dzienniku dnia: zmiana porcji albo usunięcie. Wpis ma własną kopię makro, więc późniejsza edycja przepisu nie zmienia historii.
  function openFood(eid) {
    const k = key(mealDay), e = state.food[k]?.[eid]; if (!e) return;
    overlay.innerHTML = sheet(esc(e.name), `${mealDayLabel()}, ${mealDay.getDate()} ${MONTHS_GEN[mealDay.getMonth()]}`, `<div id="fd-tiles"></div>${portionHtml(e.x)}<button class="primary" id="fd-save">Zapisz</button><button class="danger" id="fd-del">Usuń z dnia</button>`, 'Zjedzony posiłek');
    const x = bindPortion(e.x, v => { $('fd-tiles').innerHTML = tiles(portion({ ...e, x: v })); });
    $('fd-save').addEventListener('click', () => { e.x = x(); save(); close(); render(); });
    $('fd-del').addEventListener('click', () => { delete state.food[k][eid]; if (!Object.keys(state.food[k]).length) delete state.food[k]; save(); close(); render(); toast(`Usunięto: ${e.name}`); });
  }

  // Zdjęcie zmniejszone do ~560 px (JPEG), żeby zmieściło się w pamięci przeglądarki i w synchronizacji.
  function shrinkPhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, 560 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Nie udało się wczytać zdjęcia')); };
      img.src = url;
    });
  }

  // Kreator posiłku: nazwa, zdjęcie, składniki (gramy + makro na 100 g). Suma i kalorie liczą się na bieżąco.
  function openMealForm(id) {
    const m = id ? state.meals[id] : null;
    const d = { photo: m?.photo || '', items: m ? m.items.map(x => ({ ...x })) : [{ n: '', g: 0, p: 0, c: 0, f: 0 }] };
    const F = [['g', 'Gramy'], ['p', 'Białko'], ['c', 'Węgle'], ['f', 'Tłuszcz']];
    const ingHtml = (it, i) => `<div class="ing" data-i="${i}"><div class="ing-top"><input type="text" class="in-n" placeholder="Składnik, np. ryż" maxlength="40" value="${esc(it.n)}" aria-label="Nazwa składnika" autocomplete="off">${d.items.length > 1 ? `<button type="button" class="dots ing-x" aria-label="Usuń składnik">${XMARK}</button>` : ''}</div><div class="ing-g">${F.map(([k, l]) => `<label class="field"><span class="lab">${l}</span><input type="text" inputmode="decimal" data-k="${k}" value="${it[k] ? nf(it[k]) : ''}" placeholder="0" autocomplete="off"></label>`).join('')}</div><small class="ing-sum"></small></div>`;
    overlay.innerHTML = sheet(m ? 'Edytuj posiłek' : 'Nowy posiłek', '', `<form id="mform" class="lform" novalidate>
      <div class="field"><label for="mf-name">Nazwa</label><input id="mf-name" type="text" maxlength="40" value="${m ? esc(m.name) : ''}" placeholder="np. Owsianka z bananem" autocomplete="off"></div>
      <div class="field"><span class="lab">Zdjęcie</span><div id="mf-pic"></div></div>
      <div class="field"><span class="lab">Składniki <em class="lab-h">makro na 100 g, jak na opakowaniu</em></span><div class="ings" id="mf-ings"></div><button type="button" class="allweek" id="mf-add">+ Składnik</button></div>
      <div class="mf-total"><div id="mf-sum"></div><button class="primary" type="submit">${m ? 'Zapisz' : 'Utwórz'}</button></div>
    </form>`, m ? 'Edytuj posiłek' : 'Nowy posiłek');
    overlay.querySelector('.sheet').classList.add('wide');
    const f = $('mform');
    const drawPic = () => {
      $('mf-pic').innerHTML = d.photo
        ? `<div class="mf-pic has"><img src="${d.photo}" alt=""><div class="pic-acts"><label class="pic-b">Zmień<input type="file" accept="image/*" hidden></label><button type="button" class="pic-b" id="mf-nopic">Usuń</button></div></div>`
        : `<label class="mf-pic">${CAMERA}<span>Dodaj zdjęcie</span><input type="file" accept="image/*" hidden></label>`;
      $('mf-nopic')?.addEventListener('click', () => { d.photo = ''; drawPic(); });
      $('mf-pic').querySelector('input[type=file]').addEventListener('change', async ev => {
        const file = ev.target.files?.[0]; if (!file) return;
        try { d.photo = await shrinkPhoto(file); drawPic(); } catch (err) { toast(err.message); }
      });
    };
    const rowSum = i => {
      const it = d.items[i], el = f.querySelector(`.ing[data-i="${i}"] .ing-sum`); if (!el) return;
      const q = { p: it.p * it.g / 100, c: it.c * it.g / 100, f: it.f * it.g / 100 };
      el.classList.toggle('bad', it.p + it.c + it.f > 100);
      el.innerHTML = it.p + it.c + it.f > 100 ? 'Makro większe niż 100 g na 100 g — sprawdź wartości' : it.g ? `<b>${n0(kcalOf(q))} kcal</b> · B ${nf(r1(q.p))} · W ${nf(r1(q.c))} · T ${nf(r1(q.f))}` : 'Wpisz gramaturę i makro z opakowania';
    };
    const total = () => { const tt = mealTotals(d.items); $('mf-sum').innerHTML = `<b>${n0(kcalOf(tt))} kcal</b><span>${n0(tt.g)} g · B ${nf(tt.p)} · W ${nf(tt.c)} · T ${nf(tt.f)}</span>`; };
    const drawIngs = () => { $('mf-ings').innerHTML = d.items.map(ingHtml).join(''); d.items.forEach((_, i) => rowSum(i)); total(); };
    f.addEventListener('input', ev => {
      const row = ev.target.closest('.ing'); if (!row) return;
      const i = +row.dataset.i, it = d.items[i];
      if (ev.target.classList.contains('in-n')) it.n = ev.target.value;
      else it[ev.target.dataset.k] = num(ev.target.value);
      rowSum(i); total();
    });
    f.addEventListener('click', ev => {
      const x = ev.target.closest('.ing-x'); if (!x) return;
      d.items.splice(+x.closest('.ing').dataset.i, 1); drawIngs();
    });
    $('mf-add').addEventListener('click', () => {
      d.items.push({ n: '', g: 0, p: 0, c: 0, f: 0 }); drawIngs();
      f.querySelector(`.ing[data-i="${d.items.length - 1}"] .in-n`).focus();
    });
    f.addEventListener('submit', ev => {
      ev.preventDefault();
      const name = $('mf-name').value.trim();
      if (!name) { toast('Podaj nazwę posiłku'); $('mf-name').focus(); return; }
      const items = d.items.filter(it => it.n.trim() || it.g || it.p || it.c || it.f).map(it => ({ n: it.n.trim(), g: it.g, p: it.p, c: it.c, f: it.f }));
      const noG = items.find(it => !it.g);
      if (noG) { toast(`Podaj gramaturę${noG.n ? ': ' + noG.n : ''}`); return; }
      if (!items.length) { toast('Dodaj przynajmniej jeden składnik'); return; }
      const mid = id || 'm' + Date.now().toString(36);
      state.meals[mid] = { name, items, created: m?.created || Date.now(), ...(d.photo ? { photo: d.photo } : {}) };
      save(); close(); render(); toast(m ? 'Zapisano' : `Utworzono „${name}”`);
    });
    drawPic(); drawIngs();
    if (!m) $('mf-name').focus();
  }

  // Zapotrzebowanie: kalorie i makro na dzień. Pusty kcal = policzony z makro.
  function openGoals() {
    const g = state.goals || {};
    overlay.innerHTML = sheet('Zapotrzebowanie', 'dziennie', `<form id="gform" class="lform" novalidate>
      <div class="field"><label for="g-kcal">Kalorie</label><input id="g-kcal" type="text" inputmode="numeric" value="${g.kcal || ''}" placeholder="np. 2400" autocomplete="off"></div>
      <div class="row3">${[['p', 'Białko'], ['c', 'Węgle'], ['f', 'Tłuszcz']].map(([k, l]) => `<div class="field g-${k}"><label for="g-${k}">${l} (g)</label><input id="g-${k}" type="text" inputmode="decimal" value="${g[k] ? nf(g[k]) : ''}" placeholder="0" autocomplete="off"></div>`).join('')}</div>
      <p class="g-hint" id="g-hint"></p>
      <button class="primary" type="submit">Zapisz</button>
      ${state.goals ? '<button class="danger" type="button" id="g-clear">Usuń zapotrzebowanie</button>' : ''}
    </form>`, 'Zapotrzebowanie');
    const vals = () => ({ kcal: Math.round(num($('g-kcal').value)), p: num($('g-p').value), c: num($('g-c').value), f: num($('g-f').value) });
    const hint = () => {
      const v = vals(), mk = kcalOf(v);
      $('g-hint').innerHTML = !mk ? 'Białko i węgle mają 4 kcal w gramie, tłuszcz 9.'
        : `Makro daje <b>${n0(mk)} kcal</b>${v.kcal && Math.abs(v.kcal - mk) > 30 ? ` · <button type="button" class="linkish" id="g-fix">ustaw kalorie na ${n0(mk)}</button>` : ''}`;
      $('g-fix')?.addEventListener('click', () => { $('g-kcal').value = mk; hint(); });
    };
    $('gform').addEventListener('input', hint); hint();
    $('g-clear')?.addEventListener('click', () => { state.goals = null; save(); close(); render(); });
    $('gform').addEventListener('submit', ev => {
      ev.preventDefault();
      const v = vals(); if (!v.kcal) v.kcal = kcalOf(v);
      state.goals = v.kcal || v.p || v.c || v.f ? v : null;
      save(); close(); render(); toast('Zapisano zapotrzebowanie');
    });
    $('g-kcal').focus();
  }

  $('view-meals').addEventListener('click', e => {
    if (e.target.closest('[data-meal-new]')) { openMealForm(null); return; }
    const lg = e.target.closest('[data-meal-log]'); if (lg) { logMeal(lg.dataset.mealLog, 1); return; }
    const op = e.target.closest('[data-meal]'); if (op) { openMeal(op.dataset.meal); return; }
    const fd = e.target.closest('[data-food]'); if (fd) openFood(fd.dataset.food);
  });
  $('meal-dock').addEventListener('click', openGoals);

  /* ---------- licznik czasu (działa po wyjściu z aplikacji: liczy od zapisanej godziny startu) ---------- */
  const TIMER_KEY = 'hbtrack.timer';
  const readTimer = () => { try { return JSON.parse(localStorage.getItem(TIMER_KEY)); } catch (_) { return null; } };
  let timer = readTimer(), timerInt = null;
  const timerOf = h => h.clock ? 'min' : '';
  const timeUnit = h => { const t = timerOf(h); return t === 'min' ? 60 : t === 'h' ? 3600 : 0; };
  // nawyk tak/nie z timerem: czas z kreatora (h.dur); liczbowy: brakująca część celu
  const timerGoal = h => h.target;
  const timerLeft = () => timer ? Math.max(0, timer.seconds - (Date.now() - timer.startedAt) / 1000) : 0;
  const fmtLeft = sec => { const s = Math.ceil(sec), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + pad(mm) : mm) + ':' + pad(ss); };
  const spentOf = (h, k) => state.spent[h.id + '|' + k] || 0;
  const timerNeed = (h, k) => Math.round((timerGoal(h) - (h.type === 'bool' ? 0 : getVal(h, k) || 0)) * timeUnit(h) - spentOf(h, k));
  let timerCard = null; // id nawyku, którego zatrzymany timer wciąż widać w okienku
  let cardRun = null;    // poprzedni stan okienka (odliczanie / pauza) — do animacji przełączenia
  const timerFull = h => timerGoal(h) * timeUnit(h);
  function startTimer(h) {
    if (timer) stopTimer(false, false);
    timerCard = null;
    const k = todayKey(), unit = timeUnit(h), base = h.type === 'bool' ? 0 : getVal(h, k) || 0, need = timerNeed(h, k);
    if (!unit || need <= 0) return;
    timer = { hid: h.id, k, startedAt: Date.now(), seconds: need, base, unit };
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); } catch (_) { }
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
    render(); tickTimer(true);
  }
  // finish=true: cel osiągnięty; false: stop wcześniej — dopisuje przeliczony czas
  // keep: po zatrzymaniu okienko zostaje z zapamiętanym czasem (zamyka je tylko ×)
  function stopTimer(finish, keep = true) {
    if (!timer) return;
    const t = timer; timer = null; clearInterval(timerInt); timerInt = null;
    try { localStorage.removeItem(TIMER_KEY); } catch (_) { }
    const h = state.habits.find(x => x.id === t.hid); if (!h) { render(); return; }
    if (finish) {
      delete state.spent[h.id + '|' + t.k];
      setVal(h, t.k, h.type === 'bool' ? 1 : h.target); justCell = { h: h.id, k: t.k }; timerDone = h.id;
      navigator.vibrate?.([80, 60, 80]);
      toast(`${h.name}: zrobione`);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) { try { new Notification("Grochu's tracker", { body: `${h.name}: czas minął — zrobione ✓`, icon: 'icons/icon-192.png' }); } catch (_) { } }
    } else {
      // Stop = pauza: kolejny start liczy od miejsca zatrzymania. Liczbowy: pełne minuty (godziny: co 0,01 h) dopisują się do wartości.
      const sk = h.id + '|' + t.k, total = Math.min(t.seconds, (Date.now() - t.startedAt) / 1000) + (state.spent[sk] || 0);
      const q = h.type === 'bool' ? 0 : t.unit === 60 ? 60 : 36, units = q ? Math.floor(total / q + 1e-9) : 0, rest = Math.round(total - units * q);
      if (units > 0) { setVal(h, t.k, Math.min(h.target, +(t.base + units * (q === 60 ? 1 : .01)).toFixed(2))); justCell = { h: h.id, k: t.k }; }
      if (rest > 0) state.spent[sk] = rest; else delete state.spent[sk];
      save();
    }
    timerCard = !finish && keep ? t.hid : null;
    render();
  }
  function closeTimerCard() {
    if (timer) stopTimer(false, false);
    timerCard = null;
    const card = $('timer-card');
    if (card.hidden || calm()) { render(); return; }
    const a = card.animate({ opacity: [1, 0], transform: ['none', 'translateY(-10px) scale(.97)'] }, { duration: 220, easing: 'ease-in', fill: 'forwards' });
    let done = false;
    const end = () => { if (done) return; done = true; render(); a.cancel(); };
    a.onfinish = end; setTimeout(end, 300); // zapas, gdy karta w tle wstrzyma animacje
  }
  function tickTimer(start) {
    if (!timer) { if (!timerCard) $('timer-card').hidden = true; return; }
    if (timer.k !== todayKey()) { stopTimer(false, false); return; } // licznik z poprzedniego dnia: zapisz, co było
    const left = timerLeft();
    if (left <= 0) { stopTimer(true); return; }
    document.querySelectorAll('[data-timer-left]').forEach(el => { el.textContent = fmtLeft(left); });
    const bar = document.querySelector('#timer-card .tbar i'), th = state.habits.find(x => x.id === timer.hid); if (bar && th) bar.style.width = (100 - left / timerFull(th) * 100) + '%';
    if (start && !timerInt) timerInt = setInterval(() => tickTimer(false), 1000);
  }
  function renderTimerCard() {
    const card = $('timer-card');
    const tk = todayKey(), hid = timer ? timer.hid : timerCard, h = hid && state.habits.find(x => x.id === hid);
    const run = !!timer, left = !h ? 0 : run ? timerLeft() : timerNeed(h, tk);
    if (!h || (!run && (left <= 0 || !timeUnit(h) || status(h, fromKey(tk)) === 'done'))) { if (!run) timerCard = null; card.hidden = true; cardRun = null; return; }
    if (view !== 'week') { card.hidden = true; return; }
    const swap = cardRun !== null && cardRun !== run && !card.hidden; cardRun = run;
    card.hidden = false;
    card.classList.toggle('paused', !run);
    const act = run ? `<button class="tstop" data-timer-stop>${STOP} Stop</button>` : `<button class="tstop go" data-timer="${h.id}">${PLAY} Start</button>`;
    card.innerHTML = `<div class="tinfo"><b>${esc(h.name)}</b><small>${h.type === 'bool' ? `${nf(timerGoal(h))} ${timerOf(h)}` : `cel ${nf(h.target)} ${esc(h.unit)}`}</small></div><div class="ttime"${run ? ' data-timer-left' : ''}>${fmtLeft(left)}</div><div class="tact${swap ? ' swap' : ''}">${act}<button class="tclose" data-timer-close aria-label="Zamknij">${XMARK}</button></div><div class="tbar"><i style="width:${100 - left / timerFull(h) * 100}%"></i></div>`;
  }

  /* ---------- zdarzenia ---------- */
  document.addEventListener('click', e => {
    const c = e.target.closest('.ob'); if (c && !c.disabled) {
      if (e.clientX || e.clientY) ripple(e.clientX, e.clientY, .8);
      const h = state.habits.find(x => x.id === c.dataset.h);
      if (timer && timer.hid === h.id) { stopTimer(false); return; } // kółko przy działającym timerze = pauza
      // zegar: dziś startuje odliczanie, w inne dni (albo po osiągnięciu celu) otwiera edycję minut
      if (c.hasAttribute('data-clock')) { if (c.dataset.k === todayKey() && timerNeed(h, c.dataset.k) > 0) startTimer(h); else openEditor(h.id, c.dataset.k); return; }
      // tak/nie: klik przełącza tylko zrobione ↔ puste
      if (h.type === 'bool') { const od = c.hasAttribute('data-od'); setVal(h, c.dataset.k, getVal(h, c.dataset.k) === 1 ? null : 1); justCell = { h: h.id, k: c.dataset.k }; if (od) renderSmooth(); else render(); if (od) toast(`Nadrobione: ${h.name}`); }
      else openEditor(h.id, c.dataset.k);
      return;
    }
    const sh = e.target.closest('[data-sum-habit]'); if (sh) { sumHabit = sh.dataset.sumHabit; animList = true; render(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-sum-pick]')) { sumHabit = null; animList = true; render(); return; }
    const sm = e.target.closest('[data-sum-mode]');
    if (sm) { sumMode = sm.dataset.sumMode; if (sumMode === 'month') monthStart = monthOf(isMobile() ? selDay : addDays(weekStart, 3)); animList = true; render(); return; }
    const nt = e.target.closest('[data-note]'); if (nt) { openNote(nt.dataset.note); return; }
    const us = e.target.closest('[data-unskip]'); if (us) { delete state.skips[us.dataset.unskip]; save(); renderSmooth(); return; }
    const sk = e.target.closest('[data-skip]'); if (sk) { state.skips[sk.dataset.skip] = 1; save(); renderSmooth(); return; }
    const ts = e.target.closest('[data-timer]'); if (ts) { const h = state.habits.find(x => x.id === ts.dataset.timer); if (h) startTimer(h); return; }
    if (e.target.closest('[data-timer-stop]')) { stopTimer(false); return; }
    if (e.target.closest('[data-timer-close]')) { closeTimerCard(); return; }
    if (e.target.closest('[data-break-open]')) { openBreak(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { rowMenu = more.dataset.more; render(); document.querySelector(`[data-edit="${rowMenu}"]`)?.focus(); return; }
    const ed = e.target.closest('[data-edit]'); if (ed) { rowMenu = null; render(); openHabitForm(ed.dataset.edit); return; }
    const dl = e.target.closest('[data-del]'); if (dl) { rowMenu = null; render(); confirmDelete(dl.dataset.del); return; }
    if (rowMenu && !e.target.closest('.racts') && !e.target.closest('#overlay')) { rowMenu = null; render(); }
    const vt = e.target.closest('.vtab[data-view]');
    if (vt) {
      if (vt.dataset.view === 'calendar' && view !== 'calendar') {
        // z bieżącego tygodnia (lub dnia na telefonie) → bieżący miesiąc; z innego tygodnia → miesiąc, w którym leży jego większość
        const now = new Date();
        monthStart = isMobile() ? monthOf(selDay)
          : key(weekStart) === key(startOfWeek(now)) ? monthOf(now) : monthOf(addDays(weekStart, 3));
      }
      setView(vt.dataset.view); return;
    }
    const go = e.target.closest('[data-goto]');
    if (go && !go.disabled) { const g = fromKey(go.dataset.goto); weekStart = g < fromKey(state.start) ? fromKey(state.start) : g; if (go.dataset.day) selDay = fromKey(go.dataset.day); animList = true; setView('week'); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('#add-habit')) { openHabitForm(null); return; }
    const nav = e.target.closest('[data-nav]'); if (nav) { if (!nav.disabled) step(+nav.dataset.nav); return; }
    if (e.target.closest('#this-week')) { selDay = dayOnly(new Date()); weekStart = startOfWeek(new Date()); monthStart = monthOf(new Date()); mealDay = dayOnly(new Date()); animList = true; render(); }
  });
  // Nie da się cofnąć przed pierwszy tydzień aplikacji (state.start) ani przed jego miesiąc.
  function canPrev() {
    const start = fromKey(state.start);
    if (view === 'calendar') return monthStart > monthOf(start);
    if (view === 'meals') return true;
    if (view === 'summary') return sumMode === 'month' ? monthStart > monthOf(start) : weekStart > start;
    return isMobile() ? selDay > start : weekStart > start;
  }
  function step(dir) {
    if (dir < 0 && !canPrev()) return;
    if (view === 'calendar') { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + dir, 1); animList = true; }
    else if (view === 'meals') { mealDay = addDays(mealDay, dir); animList = true; }
    else if (view === 'summary' && sumMode === 'month') { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + dir, 1); animList = true; }
    else if (view === 'summary') { weekStart = addDays(weekStart, 7 * dir); selDay = addDays(selDay, 7 * dir); if (selDay < fromKey(state.start)) selDay = fromKey(state.start); animList = true; }
    else if (isMobile()) { selDay = addDays(selDay, dir); weekStart = startOfWeek(selDay); slideDir = dir; }
    else { weekStart = addDays(weekStart, 7 * dir); slideDir = dir; }
    render();
  }
  // Płynne przejście zamiast przebudowy: elementy listy jadą ze starego miejsca na nowe (FLIP), nowe się wyłaniają.
  function renderSmooth() {
    const old = new Map([...list.children].filter(el => el.dataset.fk).map(el => [el.dataset.fk, el.getBoundingClientRect().top]));
    render();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    [...list.children].forEach(el => {
      const was = old.get(el.dataset.fk);
      if (was == null) { el.animate({ opacity: [0, getComputedStyle(el).opacity] }, { duration: 300, easing: 'ease-out' }); return; }
      const d = was - el.getBoundingClientRect().top;
      if (d) el.animate({ transform: [`translateY(${d}px)`, 'none'] }, { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
  function setView(v) { if (v === 'summary' && view !== 'summary') sumHabit = null; view = v; rowMenu = null; animList = true; try { localStorage.setItem('hbtrack.view', view); } catch (_) { } render(); }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.innerHTML) close();
    else if (e.key === 'Escape' && rowMenu) { const id = rowMenu; rowMenu = null; render(); document.querySelector(`[data-more="${id}"]`)?.focus(); return; }
    if (overlay.innerHTML || e.target.matches('input')) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!checkDayChange()) render(); tickTimer(true); } });
  window.addEventListener('focus', checkDayChange);
  mq.addEventListener('change', () => {
    // przy przejściu na telefon pokaż dziś, jeśli jest w oglądanym tygodniu, inaczej poniedziałek
    const t = dayOnly(new Date());
    selDay = key(startOfWeek(t)) === key(weekStart) ? t : new Date(weekStart);
    rowMenu = null; render();
  });
  setInterval(checkDayChange, 60000); // zapas, gdy komputer usnął i timer się spóźnił

  let tt;
  function toast(m) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => el.hidden = true, 2200);
  }

  /* ---------- notatka dnia (telefon) ---------- */
  document.addEventListener('input', e => { if (e.target.id === 'note-input') setNote(e.target.dataset.k, e.target.value); });
  document.addEventListener('keydown', e => { if (e.target.id === 'note-input' && e.key === 'Enter') e.target.blur(); });

  /* ---------- przeciąganie za uchwyt ⋮⋮ = kolejność ---------- */
  const list = $('list');
  let drag = null;
  const isRow = el => el.classList.contains('o-row');
  const nextRow = (el, dir) => { let n = dir > 0 ? el.nextElementSibling : el.previousElementSibling; while (n && !isRow(n)) n = dir > 0 ? n.nextElementSibling : n.previousElementSibling; return n; };

  list.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip');
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const row = grip.closest('.o-row'), r = row.getBoundingClientRect();
    rowMenu = null;
    drag = { row, id: row.dataset.id, grab: e.clientY - r.top, pid: e.pointerId, moved: false };
    try { grip.setPointerCapture(e.pointerId); } catch (_) { }
    row.classList.add('dragging');
    document.body.classList.add('is-dragging');
  });
  list.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const { row } = drag, y = e.clientY;
    // gdzie wstawić: przed pierwszym elementem, którego środek jest poniżej kursora
    let before = null;
    for (const el of list.children) {
      if (el === row) continue;
      const b = el.getBoundingClientRect();
      if (y < b.top + b.height / 2) { before = el; break; }
    }
    const need = before ? row.nextElementSibling !== before : list.lastElementChild !== row;
    if (need) {
      // FLIP: pozostałe elementy płynnie przesuwają się na nowe miejsca
      const others = [...list.children].filter(el => el !== row);
      const first = new Map(others.map(el => [el, el.getBoundingClientRect().top]));
      if (before) list.insertBefore(row, before); else list.appendChild(row);
      others.forEach(el => {
        const d = first.get(el) - el.getBoundingClientRect().top;
        if (!d) return;
        el.style.transition = 'none'; el.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => { el.style.transition = 'transform .16s ease'; el.style.transform = ''; });
      });
      drag.moved = true;
    }
    // przeciągany wiersz jedzie za kursorem/palcem
    row.style.transform = 'none';
    const top = row.getBoundingClientRect().top;
    row.style.transform = `translateY(${y - drag.grab - top}px)`;
    if (y < 60) window.scrollBy(0, -8); else if (y > innerHeight - 60) window.scrollBy(0, 8);
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const g = drag; drag = null;
    document.body.classList.remove('is-dragging');
    g.row.classList.remove('dragging');
    g.row.style.transform = '';
    const h = state.habits.find(x => x.id === g.id); if (!h) return render();
    const arr = state.habits.filter(x => x !== h);
    const nx = nextRow(g.row, 1), pv = nextRow(g.row, -1);
    let idx = nx ? arr.findIndex(x => x.id === nx.dataset.id) : -1;
    if (idx < 0) idx = pv ? arr.findIndex(x => x.id === pv.dataset.id) + 1 : 0;
    arr.splice(idx, 0, h);
    state.habits = arr;
    save(); render();
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);

  /* ---------- telefon: przesuń wiersz w prawo = zrobione, w lewo = wyczyść ---------- */
  let swipe = null, suppressClick = false;
  const canSwipe = id => { const h = state.habits.find(x => x.id === id); const s = h && status(h, selDay); return !!h && isMobile() && view === 'week' && !['off', 'pre', 'future', 'rest'].includes(s); };
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.o-row');
    if (!row || drag || e.target.closest('.grip, .rmenu') || !canSwipe(row.dataset.id)) return;
    swipe = { row, id: row.dataset.id, x0: e.clientX, y0: e.clientY, dx: 0, on: false, pid: e.pointerId };
  });
  list.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
    if (!swipe.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipe.on = true; swipe.row.classList.add('swiping'); }
      else if (Math.abs(dy) > 10) { swipe = null; return; }
      else return;
    }
    swipe.dx = dx;
    const x = Math.max(-140, Math.min(140, dx));
    swipe.row.style.transform = `translateX(${x}px)`;
    swipe.row.classList.toggle('sw-done', x > 80);
    swipe.row.classList.toggle('sw-clear', x < -80);
  });
  const endSwipe = (e, cancelled) => {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const s = swipe; swipe = null;
    if (!s.on) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
    s.row.classList.remove('swiping', 'sw-done', 'sw-clear');
    s.row.style.transform = '';
    if (cancelled || Math.abs(s.dx) < 80) return;
    const h = state.habits.find(x => x.id === s.id); if (!h) return;
    setVal(h, key(selDay), s.dx > 0 ? (h.type === 'bool' ? 1 : h.target) : null); justCell = { h: h.id, k: key(selDay) };
    render();
  };
  list.addEventListener('pointerup', e => endSwipe(e, false));
  list.addEventListener('pointercancel', e => endSwipe(e, true));
  document.addEventListener('click', e => { if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);

  /* ---------- efekty: dotknięcie kafelka, iskry, domknięcie dnia, woda w kółku ---------- */
  // Klik w kafelek (poza przyciskami): leciutko rośnie i od razu wraca.
  list.addEventListener('click', e => {
    const row = e.target.closest('.o-row');
    if (!row || e.target.closest('button, input, a, label') || calm()) return;
    row.animate({ transform: ['scale(1)', 'scale(1.025)', 'scale(1)'] }, { duration: 320, easing: 'cubic-bezier(.3,.7,.4,1)' });
    ripple(e.clientX, e.clientY, 1);
  });
  /* ---------- morskie efekty: bąbelki, kręgi na wodzie, fala przez cały ekran przy 100% ---------- */
  const sea = document.createElement('div');
  sea.className = 'sea'; sea.setAttribute('aria-hidden', 'true');
  sea.innerHTML = SEA_SVG; // ukryta pod ekranem; pokazuje się tylko przy 100% dnia
  document.body.appendChild(sea);
  // Bąbelki z kółka przy odhaczeniu: unoszą się, kołyszą i pękają.
  function bubbles(el) {
    if (calm()) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 11; i++) {
      const s = 4 + Math.random() * 7, dx = (Math.random() - .5) * r.width * 1.4, rise = 36 + Math.random() * 60, sway = (Math.random() - .5) * 18;
      const b = document.createElement('i');
      b.className = 'bubble';
      Object.assign(b.style, { left: cx - s / 2 + 'px', top: cy - s / 2 + 'px', width: s + 'px', height: s + 'px' });
      document.body.appendChild(b);
      b.animate([
        { transform: 'translate(0,0) scale(.3)', opacity: 0 },
        { transform: `translate(${dx * .4}px,${-rise * .3}px) scale(1)`, opacity: 1, offset: .2 },
        { transform: `translate(${dx * .7 + sway}px,${-rise * .7}px) scale(1)`, opacity: .9, offset: .7 },
        { transform: `translate(${dx}px,${-rise}px) scale(1.5)`, opacity: 0 }
      ], { duration: 700 + Math.random() * 500, delay: Math.random() * 120, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' }).onfinish = () => b.remove();
      setTimeout(() => b.remove(), 1600); // zapas, gdy karta w tle wstrzyma animacje
    }
  }
  // Kręgi na wodzie w miejscu dotknięcia.
  function ripple(x, y, k = 1) {
    if (calm()) return;
    [0, 140].forEach(delay => {
      const r = document.createElement('i');
      r.className = 'ripple';
      Object.assign(r.style, { left: x + 'px', top: y + 'px' });
      document.body.appendChild(r);
      r.animate({ transform: ['translate(-50%,-50%) scale(.1)', `translate(-50%,-50%) scale(${k})`], opacity: [.55, 0] },
        { duration: 650, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }).onfinish = () => r.remove();
      setTimeout(() => r.remove(), 1000);
    });
  }
  // 100% dnia: fala wyłania się spod ekranu i przechodzi przez cały ekran, z dna leci chmura bąbelków.
  function swell() {
    if (calm()) return;
    sea.classList.remove('swell'); void sea.offsetWidth; sea.classList.add('swell');
    setTimeout(() => sea.classList.remove('swell'), 2700);
    for (let i = 0; i < 26; i++) {
      const s = 5 + Math.random() * 10, x = Math.random() * innerWidth;
      const b = document.createElement('i');
      b.className = 'bubble';
      Object.assign(b.style, { left: x + 'px', top: innerHeight - 10 + 'px', width: s + 'px', height: s + 'px' });
      document.body.appendChild(b);
      const rise = innerHeight * (.3 + Math.random() * .45), sway = (Math.random() - .5) * 60;
      b.animate([
        { transform: 'translate(0,0)', opacity: 0 },
        { transform: `translate(${sway * .5}px,${-rise * .4}px)`, opacity: .9, offset: .3 },
        { transform: `translate(${sway}px,${-rise}px) scale(1.4)`, opacity: 0 }
      ], { duration: 1400 + Math.random() * 900, delay: Math.random() * 500, easing: 'ease-out', fill: 'backwards' }).onfinish = () => b.remove();
      setTimeout(() => b.remove(), 3200);
    }
  }
  // Domknięcie dnia: zielona fala po kafelkach i podskok procentu.
  function celebrate() {
    navigator.vibrate?.([15, 60, 25]);
    if (calm()) return;
    $('week-pct').animate({ transform: ['scale(1)', 'scale(1.14)', 'scale(.98)', 'scale(1)'], color: ['#fff', '#4ADE80', '#4ADE80', '#fff'] }, { duration: 900, easing: 'ease-out' });
    swell();
  }
  // Po przebudowie listy: woda przelewa się ze starego poziomu, iskry, ewentualne świętowanie.
  const waterTop = l => `${(9 + (100 - l) * .88).toFixed(2)}%`; // jak w CSS: w środku obwódki, z zapasem na falę
  // Kółko liczbowe osiąga cel: woda dolewa się do pełna, dopiero potem pojawia się ptaszek.
  function fillUp(c, was) {
    c.classList.add('filling'); c.insertAdjacentHTML('afterbegin', WATER);
    const ws = [...c.querySelectorAll('.wv')];
    const a = ws.map(w => w.animate({ top: [waterTop(was), '-30%'] }, { duration: 560, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }));
    let done = false;
    const end = () => { if (done) return; done = true; ws.forEach(w => w.remove()); c.classList.remove('filling', 'just'); void c.offsetWidth; c.classList.add('just'); };
    a[0].onfinish = end; setTimeout(end, 900); // zapas, gdy karta w tle wstrzyma animacje
  }
  function afterList(el) {
    let filled = null;
    el.querySelectorAll('.c[data-lv]').forEach(c => {
      const p = +c.style.getPropertyValue('--lv'), was = levels.get(c.dataset.lv);
      levels.set(c.dataset.lv, p);
      if (was == null || was === p || calm()) return;
      if (c.classList.contains('done')) { if (!document.hidden) { fillUp(c, was); filled = c; } return; }
      const top = waterTop;
      c.querySelectorAll('.wv').forEach(w => w.animate({ top: [top(was), top(p)] }, { duration: 650, easing: 'cubic-bezier(.3,.7,.3,1)' }));
    });
    if (justCell) { const c = el.querySelector(`.ob[data-h="${CSS.escape(justCell.h)}"][data-k="${justCell.k}"] .c.done`); if (c) { if (c === filled) setTimeout(() => bubbles(c), 560); else bubbles(c); } }
    if (recordToast) { const m = recordToast; recordToast = null; setTimeout(() => toast(m), 500); }
    // koniec timera: jedno spokojne, zielone pulsowanie kafelka
    if (timerDone) {
      const r = el.querySelector(`.o-row[data-id="${CSS.escape(timerDone)}"]`); timerDone = null;
      const off = '0 0 0 0 rgba(74,222,128,0), inset 0 0 0 1px rgba(74,222,128,0)';
      if (r && !calm()) r.animate({ boxShadow: [off, '0 0 36px 4px rgba(74,222,128,.28), inset 0 0 0 1px rgba(74,222,128,.7)', off] }, { duration: 1600, easing: 'ease-in-out' });
    }
    // przy otwartym edytorze świętowanie czeka na jego zamknięcie
    if (party) { party = false; if (overlay.firstChild) partyLater = true; else celebrate(); }
    userAct = false;
  }

  /* ---------- telefon: bez przybliżania (Safari ignoruje user-scalable=no, więc blokujemy gest szczypania) ---------- */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });

  /* ---------- PWA: działanie offline (instalację proponuje sama przeglądarka) ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
  }

  render();
  tickTimer(true); // licznik z poprzedniego uruchomienia: dokończ albo wznów
  scheduleMidnight();

  /* ---------- konto i synchronizacja (js/cloud.js) ---------- */
  updateGate();
  if (window.Cloud) {
    let wasLogged = !!window.Cloud.user;
    // np. wygasła sesja → powrót do ekranu logowania
    window.Cloud.onChange(() => { const now = !!window.Cloud.user; if (now !== wasLogged) { wasLogged = now; updateGate(); } });
    window.Cloud.attach({ getState: () => state, applyState });
  }
})();
