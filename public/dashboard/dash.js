// Небольшая замена среды Dashboard из claude.ai: загружает CSV, считает dash.calc и перерисовывает dash.draw.
(function () {
  const DATASETS = {
    projects: 'data/sample_projects.csv',
    weekly: 'data/sample_weekly.csv',
  };
  const LIGHT = ['#2f6bd8', '#d9822b', '#23966a', '#c2417a', '#7a5cd6', '#1f9fb3', '#a8961c', '#7c8590'];
  const DARK = ['#6b9cff', '#f0a35a', '#4cc796', '#e872a6', '#a58cf0', '#4fc4d6', '#d4c04a', '#a3abb5'];

  const tables = {};
  const status = {};
  const calcs = {};
  const draws = {};
  const onDataFns = [];

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const columns = rows.shift() || [];
    return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((k, i) => [k, r[i] ?? '']))) };
  }

  function data(id) {
    if (id in DATASETS) {
      if (status[id] === 'ok') return { status: 'ok', data: tables[id].rows, columns: tables[id].columns, meta: [], refreshing: false };
      return { status: status[id] || 'loading', data: [], columns: [], meta: [], refreshing: false };
    }
    if (id in calcs) {
      const c = calcs[id];
      const ins = c.inputs.map(data);
      const bad = ins.find((i) => i.status !== 'ok');
      if (bad) return { status: bad.status === 'error' ? 'error' : 'loading', data: [], columns: [], meta: [] };
      if (!('value' in c)) {
        try { c.value = c.fn(...ins.map((i) => i.data)); }
        catch (e) { console.error('dash.calc ' + id, e); return { status: 'error', data: [], columns: [], meta: [] }; }
      }
      const v = c.value;
      return { status: 'ok', data: v, columns: Array.isArray(v) && v[0] ? Object.keys(v[0]) : [], meta: [] };
    }
    return { status: 'missing', data: [], columns: [], meta: [] };
  }

  function runDraw(name) {
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
      try { draws[name](el); } catch (e) { console.error('dash.draw ' + name, e); }
    });
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      onDataFns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      Object.keys(draws).forEach(runDraw);
    });
  }

  const dark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  window.dash = {
    data,
    onData(fn) { onDataFns.push(fn); schedule(); },
    calc(id, def) { calcs[id] = { inputs: def.inputs, fn: def.fn, title: def.title }; },
    loader() {},
    draw(name, fn) {
      if (typeof fn === 'function') { draws[name] = fn; schedule(); }
      else if (draws[name]) runDraw(name);
    },
    refresh() {},
    params: () => ({}),
    setParams() {},
    resetParams() {},
    setLink() {},
    get colors() { return dark() ? DARK : LIGHT; },
  };

  for (const [id, url] of Object.entries(DATASETS)) {
    fetch(url, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((t) => { tables[id] = parseCSV(t); status[id] = 'ok'; })
      .catch((e) => { console.error('dataset ' + id, e); status[id] = 'error'; })
      .finally(schedule);
  }

  let w = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== w) { w = window.innerWidth; schedule(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
})();
