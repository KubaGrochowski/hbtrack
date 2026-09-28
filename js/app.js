/* Grochu's tracker — tygodniowy tracker nawyków. Dane zapisywane lokalnie w przeglądarce (localStorage). */
(() => {
  'use strict';

  const STORAGE_KEY = 'hbtrack.v1';
  const DAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
  const DAYS_FULL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
  const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const SCORE = { done: 1, part: 0.5, miss: 0 };
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
  let edit = null;
  let rowMenu = null;
  let view = 'week';
  let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  try { const v = localStorage.getItem('hbtrack.view'); if (v === 'calendar') view = v; } catch (_) { }

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
    state = withStart({ habits: s.habits || [], entries: s.entries || {}, notes: s.notes || {}, start: s.start });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { }
    render();
  }
  const habitsActive = () => state.habits.filter(h => !h.archived);
  const getVal = (h, k) => { const v = state.entries[h.id]?.[k]; return v == null ? null : v; };
  function setVal(h, k, v) {
    state.entries[h.id] ??= {};
    if (v == null) delete state.entries[h.id][k]; else state.entries[h.id][k] = v;
    save();
  }

  /* ---------- logika ---------- */
  const prog = (h, v) => v == null ? 0 : h.type === 'bool' ? (v >= 1 ? 1 : 0) : Math.min(1, v / h.target);
  function status(h, d) {
    const k = key(d), t = todayKey();
    if (k < h.created) return 'pre'; // nawyku jeszcze nie było
    if (!h.days.includes(dow(d))) return 'off';
    if (k > t) return 'future';
    const v = getVal(h, k);
    if (h.type === 'bool') { if (v === 1) return 'done'; if (v === 0) return 'miss'; return k === t ? 'pending' : 'miss'; }
    if (v == null || v === 0) return k === t ? 'pending' : 'miss';
    return v >= h.target ? 'done' : 'part';
  }
  const nf = v => v.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  const fmt = (h, v) => v == null ? '' : h.type === 'bool' ? (v >= 1 ? '✓' : '✕') : v >= 1000 ? (v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + 'k' : nf(v);
  const tgt = h => { const per = h.days.length === 7 ? 'codziennie' : h.days.map(d => DAYS[d]).join(' '); return h.type === 'bool' ? per : `${nf(h.target)} ${h.unit} · ${per}`; };
  const weekDates = (ws = weekStart) => ALL.map(i => addDays(ws, i));

  // Jeden wzór dla wszystkich procentów: suma punktów ÷ liczba zaplanowanych wpisów do dziś włącznie
  // (zrobione = 1, częściowo = ½, dzisiejsze bez wpisu = 0). Dni przyszłe się nie liczą.
  function periodPct(dates) {
    let n = 0, s = 0;
    dates.forEach(d => habitsActive().forEach(h => { const st = status(h, d); if (!(st in SCORE) && st !== 'pending') return; n++; s += SCORE[st] || 0; }));
    return n ? s / n : null;
  }
  const overall = (ws = weekStart) => periodPct(weekDates(ws));
  const dayPct = d => periodPct([d]);
  // Seria: zrobione zaplanowane dni pod rząd, licząc wstecz od dziś (dziś bez wpisu i dni wolne nie przerywają).
  function streak(h) {
    let n = 0;
    const start = fromKey(h.created || state.start);
    for (let d = dayOnly(new Date()); d >= start; d = addDays(d, -1)) {
      const s = status(h, d);
      if (s === 'off' || s === 'pre' || s === 'pending') continue;
      if (s === 'done') n++; else break;
    }
    return n;
  }
  const noteOf = k => state.notes[k] || '';
  function setNote(k, text) {
    const t = text.trim();
    if (t) state.notes[k] = t; else delete state.notes[k];
    save();
  }
  function todayDone() { const t = new Date(); const hs = habitsActive().filter(h => !['off', 'pre'].includes(status(h, t))); return [hs.filter(h => status(h, t) === 'done').length, hs.length]; }
  const pct = p => Math.round(p * 100);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CHECK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DOTS = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg>';
  const PENCIL = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3l8-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4l3 3" stroke="currentColor" stroke-width="1.6"/></svg>';
  const XMARK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const GRIP = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></g></svg>';
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
    let cal = `<div class="cal-nav">${navBtn(-1)}<div class="cal-h">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>${navBtn(1)}</div><div class="cal">`;
    for (let i = 0; i < dow(days[0]); i++) cal += `<span class="cd blank"></span>`;
    days.forEach(d => {
      const k = key(d), fut = k > t, pre = k < state.start, p = fut || pre ? null : dayPct(d);
      const note = noteOf(k);
      const cls = `cd${fut ? ' fut' : ''}${pre ? ' pre' : ''}${p == null ? ' none' : ''}${p != null ? ' hi' : ''}${k === t ? ' today' : ''}${note ? ' has-note' : ''}`;
      const tip = esc(`${DAYS_FULL[dow(d)]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}: ${p == null ? 'brak danych' : pct(p) + '%'}${note ? ' · ' + note : ''}`);
      cal += `<button class="${cls}" ${pre ? "disabled" : ""} data-goto="${key(startOfWeek(d))}" data-day="${k}" ${p == null ? '' : `style="--heat:${heat(p)}"`} aria-label="${tip}"><b>${d.getDate()}</b>${p == null ? '' : `<small>${pct(p)}%</small>`}</button>`;
    });
    $('view-calendar').innerHTML = `<section class="panel">${cal}</div></section>`;
  }

  /* ---------- render ---------- */
  const $ = id => document.getElementById(id);
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
      : mobile ? key(selDay) === key(now) : key(weekStart) === key(startOfWeek(now));
    $('this-week').closest('.weeknav').hidden = atNow;
    document.querySelectorAll('.vtab[data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
    $('view-week').hidden = view !== 'week';
    $('view-calendar').hidden = view !== 'calendar';
    if (view === 'calendar') {
      const m = monthPct(monthStart);
      $('week-label').textContent = `${MONTHS_NOM[monthStart.getMonth()]} ${monthStart.getFullYear()}`;
      $('week-pct').textContent = m == null ? '—' : pct(m) + '%';
      $('today-label').textContent = '';
    } else {
      $('week-label').textContent = range;
      $('week-pct').textContent = pct(overall() ?? 0) + '%';
      const cur = key(dates[0]) <= t && t <= key(end);
      if (cur) { const [a, b] = todayDone(); $('today-label').innerHTML = `dziś <em>${a}/${b}</em> · ${DAYS_FULL[dow(new Date())].toLowerCase()}`; }
      else $('today-label').textContent = key(end) < t ? 'miniony tydzień' : 'nadchodzący tydzień';
    }

    $('day-head').classList.toggle('single', mobile);
    $('day-head').innerHTML = mobile
      ? `${navBtn(-1)}<div class="dayname${key(selDay) === t ? ' t' : ''}">${DAYS_FULL[dow(selDay)]}<em>${selDay.getDate()} ${MONTHS_GEN[selDay.getMonth()]}</em></div>${navBtn(1)}`
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
      $('empty').innerHTML = `Nie masz jeszcze nawyków. Kliknij „+ Nawyk”, żeby dodać pierwszy, albo <button class="link" id="seed">wczytaj przykładowe</button>.`;
      $('list').innerHTML = '';
      $('view-calendar').innerHTML = '';
      $('view-week').hidden = false;
      return;
    }
    if (view === 'calendar') renderCalendar();
    // Najpierw nawyki zaplanowane na dzień odniesienia, potem pozostałe (kolejność w grupach bez zmian).
    // Telefon: wybrany dzień. Komputer: dziś, jeśli oglądany tydzień go zawiera; w innych tygodniach bez sortowania.
    // Nawyki „nie dziś” zawsze na końcu, za linią. Pora dnia to tylko etykieta na kafelku.
    // Nawyki dodane po oglądanym tygodniu (telefon: po wybranym dniu) trafiają na sam dół do sekcji „Dodane później”.
    const ref = mobile ? selDay : (key(dates[0]) <= t && t <= key(end) ? fromKey(t) : null);
    const isLater = h => h.created > key(mobile ? selDay : end);
    const isOff = h => ref && status(h, ref) === 'off';
    const cur = hs.filter(h => !isLater(h)), later = hs.filter(isLater);
    const onList = cur.filter(h => !isOff(h)), offList = cur.filter(isOff);
    let html = onList.map(rowHtml).join('');
    if (offList.length) html += (onList.length ? `<div class="grp sep"></div>` : '') + offList.map(rowHtml).join('');
    if (later.length) html += `<div class="grp later">Dodane później</div>` + later.map(rowHtml).join('');
    $('list').innerHTML = html;

    function rowHtml(h) {
      const cells = shown.map(d => {
        const s = status(h, d), v = getVal(h, key(d));
        const dis = s === 'future' || s === 'off' || s === 'pre';
        const lbl = `${h.name}, ${DAYS_FULL[dow(d)]} ${d.getDate()}: ${s === 'off' ? 'poza planem' : s === 'pre' ? 'przed dodaniem' : s === 'future' ? 'przyszłość' : v == null ? 'brak wpisu' : fmt(h, v) + ' ' + (h.unit || '')}`;
        return `<button class="ob ${s} ${key(d) === t ? 'today' : ''}" data-h="${h.id}" data-k="${key(d)}" ${dis ? 'disabled' : ''} aria-label="${esc(lbl)}"><span class="c ${s}" style="--p:${pct(prog(h, v))}">${s === 'done' ? CHECK : ''}</span></button>`;
      }).join('');
      const open = rowMenu === h.id;
      const acts = open
        ? `<div class="racts"><button class="ra edit" data-edit="${h.id}" aria-label="Edytuj ${esc(h.name)}">${PENCIL}</button><button class="ra del" data-del="${h.id}" aria-label="Usuń ${esc(h.name)}">${XMARK}</button></div>`
        : `<button class="dots" data-more="${h.id}" aria-label="Opcje: ${esc(h.name)}" aria-expanded="false">${DOTS}</button>`;
      // telefon: pod nazwą wpisana wartość dnia zamiast opisu celu; nawyk bez planu na ten dzień jest przygaszony
      let sub = tgt(h), off = false;
      if (mobile) {
        const s = status(h, selDay), v = getVal(h, key(selDay));
        off = s === 'off' || s === 'pre';
        if (s === 'off') sub = 'nie dziś';
        else if (h.type === 'num') sub = `${v == null ? 0 : nf(v)} / ${nf(h.target)} ${esc(h.unit)}`;
      }
      const sk = streak(h);
      const tl = TIMES.find(([v]) => v === h.time)?.[1];
      const tod = tl ? `<span class="tod">${tl}</span>` : '';
      const fire = sk >= 2 ? `<span class="streak" aria-label="Seria: ${sk}">${FLAME}${sk}</span>` : '';
      return `<div class="o-row${open ? ' menu-open' : ''}${off ? ' is-off' : ''}" data-id="${h.id}"><div class="name"><button class="grip" aria-label="Przenieś ${esc(h.name)}">${GRIP}</button><div class="nt"><b><span class="nm">${esc(h.name)}</span>${tod}${fire}</b><small>${sub}</small></div></div><div class="o-track">${cells}</div><div class="rmenu">${acts}</div></div>`;
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
      body = `<div class="ed-val"><button data-ed="-" aria-label="Mniej">−</button><input id="ed-input" type="number" inputmode="decimal" step="${h.step}" min="0" value="${v ?? ''}" placeholder="0" aria-label="Wartość"><button data-ed="+" aria-label="Więcej">+</button></div><div class="ed-unit">${esc(h.unit)} · cel ${nf(h.target)}</div><div class="prog"><i class="${p >= 1 ? 'full' : ''}" style="width:${p * 100}%"></i></div><div class="chips"><button data-ed="clear">Wyczyść</button><button data-ed="half">Połowa</button><button data-ed="target">Cel</button></div>`;
    } else {
      body = `<div class="yn"><button data-ed="yes" class="${v === 1 ? 'sel-done' : ''}">Zrobione</button><button data-ed="no" class="${v === 0 ? 'sel-miss' : ''}">Nie zrobione</button></div><div class="chips"><button data-ed="clear">Wyczyść wpis</button></div>`;
    }
    overlay.innerHTML = sheet(esc(h.name), dateLabel(k), body + `<button class="primary" data-close>Gotowe</button>`, 'Edycja wpisu');
    const inp = $('ed-input');
    if (inp) {
      inp.addEventListener('input', () => {
        const n = parseFloat(inp.value.replace(',', '.'));
        setVal(h, k, isNaN(n) ? null : Math.max(0, n)); render();
        const p = prog(h, getVal(h, k)); const bar = overlay.querySelector('.prog i'); bar.style.width = p * 100 + '%'; bar.classList.toggle('full', p >= 1);
      });
      inp.focus(); inp.select();
    }
  }
  overlay.addEventListener('click', e => {
    if (e.target.hasAttribute('data-close')) { close(); return; }
    const b = e.target.closest('[data-ed]'); if (!b || !edit) return;
    const h = state.habits.find(x => x.id === edit.hid), k = edit.k, a = b.dataset.ed, v = getVal(h, k) || 0;
    const map = { '+': +(v + h.step).toFixed(2), '-': Math.max(0, +(v - h.step).toFixed(2)), clear: null, half: h.target / 2, target: h.target, yes: 1, no: 0 };
    setVal(h, k, map[a]); render();
    if (h.type === 'bool' && a !== 'clear') { close(); return; }
    drawEditor();
  });

  function openHabitForm(hid) {
    const h = hid ? state.habits.find(x => x.id === hid) : null;
    const days = h ? h.days : [];
    const body = `<form id="hform">
      <div class="field"><label for="f-name">Nazwa</label><input id="f-name" type="text" required placeholder="np. Medytacja" maxlength="30" value="${h ? esc(h.name) : ''}"></div>
      <div class="field"><span class="lab">Rodzaj</span><div class="seg"><label><input type="radio" name="f-type" id="f-type-bool" value="bool" ${!h || h.type === 'bool' ? 'checked' : ''}><span>Tak / nie</span></label><label><input type="radio" name="f-type" id="f-type-num" value="num" ${h && h.type === 'num' ? 'checked' : ''}><span>Liczbowy</span></label></div></div>
      <div class="row3" id="f-numfields"><div class="field"><label for="f-target">Cel dzienny</label><input id="f-target" type="number" min="0.01" step="any" value="${h?.target ?? 10}"></div><div class="field"><label for="f-unit">Jednostka</label><input id="f-unit" type="text" value="${h ? esc(h.unit) : 'min'}" maxlength="10"></div><div class="field"><label for="f-step">Krok +/−</label><input id="f-step" type="number" min="0.01" step="any" value="${h?.step ?? 1}"></div></div>
      <div class="field"><div class="daypick" role="group" aria-label="Dni nawyku">${DAYS.map((d, i) => `<label><input type="checkbox" id="f-d${i}" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
      <div class="field"><span class="lab">Pora</span><div class="seg seg4">${[['', '—'], ...TIMES].map(([v, l]) => `<label><input type="radio" name="f-time" id="f-time-${v || 'any'}" value="${v}" ${(h?.time || '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <button class="primary" type="submit">${h ? 'Zapisz' : 'Dodaj'}</button>
      ${h ? `<button class="danger" type="button" id="f-delete">Usuń nawyk</button>` : ''}
    </form>`;
    overlay.innerHTML = sheet(h ? 'Edytuj nawyk' : 'Nowy nawyk', '', body);
    const f = $('hform');
    const sync = () => { $('f-numfields').hidden = f.querySelector('input[name="f-type"]:checked').value === 'bool'; };
    f.querySelectorAll('input[name="f-type"]').forEach(r => r.addEventListener('change', sync)); sync();
    f.style.display = 'flex'; f.style.flexDirection = 'column'; f.style.gap = '16px';
    f.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('f-name').value.trim(); if (!name) return;
      const type = f.querySelector('input[name="f-type"]:checked').value;
      const sel = [...f.querySelectorAll('.daypick input:checked')].map(x => +x.value);
      if (!sel.length) { toast('Wybierz przynajmniej jeden dzień'); return; }
      const target = Math.max(0.01, parseFloat($('f-target').value) || 1);
      const step = Math.max(0.01, parseFloat($('f-step').value) || 1);
      const unit = $('f-unit').value.trim();
      const time = f.querySelector('input[name="f-time"]:checked')?.value || '';
      // nawyk obowiązuje od dnia dodania; wcześniejsze dni pokazują „?”
      const target_ = h || { id: 'h' + Date.now().toString(36), created: todayKey() };
      Object.assign(target_, { name, type, target, step, unit, days: sel });
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
    $('confirm-del').addEventListener('click', () => { state.habits = state.habits.filter(x => x.id !== h.id); delete state.entries[h.id]; save(); close(); render(); });
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
    const foot = $('acct-foot');
    foot.hidden = !window.Cloud?.user;
    if (window.Cloud?.user) $('acct-email').textContent = window.Cloud.user.email;
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
      $('auth-form').reset(); setAuthMode('in');
      updateGate(); render();
    } catch (err) { showAuthError(authError(err)); }
    finally { btn.disabled = false; btn.textContent = label === '…' ? 'Zaloguj się' : label; }
  });
  // Wylogowanie: najpierw wysyła zmiany, potem czyści dane z urządzenia i wraca do ekranu logowania.
  $('logout').addEventListener('click', async () => {
    const b = $('logout'); b.disabled = true;
    try {
      await window.Cloud.signOut();
      applyState({ habits: [], entries: {}, notes: {} });
      updateGate();
    } catch (err) { toast(err.message); }
    finally { b.disabled = false; }
  });

  function seed() {
    const c = todayKey();
    state.habits.push(
      { id: 'woda', name: 'Woda', type: 'num', target: 2, unit: 'L', step: 0.25, days: ALL, created: c },
      { id: 'kroki', name: 'Kroki', type: 'num', target: 8000, unit: 'kroków', step: 500, days: ALL, created: c },
      { id: 'czyt', name: 'Czytanie', type: 'num', target: 20, unit: 'min', step: 5, days: ALL, created: c },
      { id: 'sen', name: 'Sen', type: 'num', target: 7, unit: 'h', step: 0.5, days: ALL, created: c },
      { id: 'silownia', name: 'Siłownia', type: 'bool', days: [0, 2, 4], created: c },
      { id: 'slodycze', name: 'Bez słodyczy', type: 'bool', days: ALL, created: c },
    );
    save(); render();
  }

  /* ---------- zdarzenia ---------- */
  document.addEventListener('click', e => {
    const c = e.target.closest('.ob'); if (c && !c.disabled) {
      const h = state.habits.find(x => x.id === c.dataset.h);
      // tak/nie: klik przełącza tylko zrobione ↔ puste
      if (h.type === 'bool') { setVal(h, c.dataset.k, getVal(h, c.dataset.k) === 1 ? null : 1); render(); }
      else openEditor(h.id, c.dataset.k);
      return;
    }
    const nt = e.target.closest('[data-note]'); if (nt) { openNote(nt.dataset.note); return; }
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
    if (go && !go.disabled) { const g = fromKey(go.dataset.goto); weekStart = g < fromKey(state.start) ? fromKey(state.start) : g; if (go.dataset.day) selDay = fromKey(go.dataset.day); setView('week'); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('#add-habit')) { openHabitForm(null); return; }
    if (e.target.closest('#seed')) { seed(); return; }
    const nav = e.target.closest('[data-nav]'); if (nav) { if (!nav.disabled) step(+nav.dataset.nav); return; }
    if (e.target.closest('#this-week')) { selDay = dayOnly(new Date()); weekStart = startOfWeek(new Date()); monthStart = monthOf(new Date()); render(); }
  });
  // Nie da się cofnąć przed pierwszy tydzień aplikacji (state.start) ani przed jego miesiąc.
  function canPrev() {
    const start = fromKey(state.start);
    if (view === 'calendar') return monthStart > monthOf(start);
    return isMobile() ? selDay > start : weekStart > start;
  }
  function step(dir) {
    if (dir < 0 && !canPrev()) return;
    if (view === 'calendar') monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + dir, 1);
    else if (isMobile()) { selDay = addDays(selDay, dir); weekStart = startOfWeek(selDay); }
    else weekStart = addDays(weekStart, 7 * dir);
    render();
  }
  function setView(v) { view = v; rowMenu = null; try { localStorage.setItem('hbtrack.view', view); } catch (_) { } render(); }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.innerHTML) close();
    else if (e.key === 'Escape' && rowMenu) { const id = rowMenu; rowMenu = null; render(); document.querySelector(`[data-more="${id}"]`)?.focus(); return; }
    if (overlay.innerHTML || e.target.matches('input')) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !checkDayChange()) render(); });
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
  const canSwipe = id => { const h = state.habits.find(x => x.id === id); const s = h && status(h, selDay); return isMobile() && view === 'week' && !['off', 'pre', 'future'].includes(s); };
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
    setVal(h, key(selDay), s.dx > 0 ? (h.type === 'bool' ? 1 : h.target) : null);
    render();
  };
  list.addEventListener('pointerup', e => endSwipe(e, false));
  list.addEventListener('pointercancel', e => endSwipe(e, true));
  document.addEventListener('click', e => { if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);

  /* ---------- PWA: działanie offline (instalację proponuje sama przeglądarka) ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
  }

  render();
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
