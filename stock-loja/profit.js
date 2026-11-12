(() => {
  const LEDGER_KEY = 'stock-loja-ledger-v1';
  const money = c => (c < 0 ? '−' : '') + 'STN ' + (Math.abs(Number(c)) / 100).toLocaleString('pt', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const cloud = () => Boolean(window.StockAuth?.isCloudMode());

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfWeek = d => { const s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; }; // semana de segunda a domingo
  const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);

  const empty = () => ({ revenue:0, cost:0, profit:0, units:0, sales:new Set(), missingCost:0 });
  function add(t, l) {
    const qty = Number(l.quantity) || 0, unit = Number(l.unit) || 0;
    const hasCost = Number.isFinite(Number(l.cost)) && l.cost !== null;
    t.revenue += unit * qty;
    t.cost += (hasCost ? Number(l.cost) : 0) * qty;
    t.profit = t.revenue - t.cost;
    t.units += qty;
    t.sales.add(l.sale || l.at);
    if (!hasCost) t.missingCost += 1;
  }

  // Lucro de hoje, da semana e do mês (linhas: { at, sale, quantity, unit, cost } em cêntimos)
  function summarize(lines, now = new Date()) {
    const from = { day:startOfDay(now), week:startOfWeek(now), month:startOfMonth(now) };
    const out = { day:empty(), week:empty(), month:empty() };
    for (const l of lines) {
      const t = new Date(l.at);
      if (Number.isNaN(t.getTime()) || t > now) continue;
      for (const k of Object.keys(from)) if (t >= from[k]) add(out[k], l);
    }
    return out;
  }

  // Detalhe por dia (14), semana (8) ou mês (6), do mais recente para o mais antigo
  function breakdown(lines, mode, now = new Date()) {
    const start = { day:startOfDay, week:startOfWeek, month:startOfMonth }[mode];
    const count = { day:14, week:8, month:6 }[mode];
    const buckets = [];
    let cur = start(now);
    for (let i = 0; i < count; i++) {
      buckets.push({ from:new Date(cur), totals:empty() });
      cur = new Date(cur);
      if (mode === 'day') cur.setDate(cur.getDate() - 1);
      else if (mode === 'week') cur.setDate(cur.getDate() - 7);
      else cur.setMonth(cur.getMonth() - 1);
    }
    const byKey = new Map(buckets.map(b => [b.from.getTime(), b]));
    for (const l of lines) {
      const t = new Date(l.at);
      if (Number.isNaN(t.getTime()) || t > now) continue;
      const b = byKey.get(start(t).getTime());
      if (b) add(b.totals, l);
    }
    return buckets;
  }
  const label = (d, mode) => mode === 'day' ? d.toLocaleDateString('pt', { weekday:'short', day:'2-digit', month:'2-digit' })
    : mode === 'week' ? 'Semana de ' + d.toLocaleDateString('pt', { day:'2-digit', month:'2-digit' })
    : d.toLocaleDateString('pt', { month:'long', year:'numeric' });

  window.StockProfit = { summarize, breakdown };

  // ----- ecrã
  const section = document.createElement('section');
  section.id = 'profitView'; section.className = 'view'; section.hidden = true;
  document.querySelector('#salesView').after(section);
  let mode = 'day', lines = [], loading = false, error = false, loadedAt = 0;

  async function load(force) {
    if (loading) return;
    if (cloud()) {
      if (!force && Date.now() - loadedAt < 30000) return;
      loading = true; render();
      const from = startOfMonth(new Date()); from.setMonth(from.getMonth() - 5);
      const rows = await window.StockAuth.loadProfitLines(from.toISOString());
      loading = false; error = rows === null; lines = rows || []; loadedAt = Date.now();
    } else {
      try { const v = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); lines = Array.isArray(v) ? v : []; } catch { lines = []; }
    }
    render();
  }

  const card = (title, t) => {
    const margin = t.revenue > 0 ? Math.round(t.profit / t.revenue * 100) + '% de margem' : 'sem vendas';
    return `<div class="pos-card profit-card"><span class="pos-muted">${esc(title)}</span>
      <strong class="profit-big ${t.profit < 0 ? 'neg' : 'pos'}">${money(t.profit)}</strong><span class="pos-muted">${esc(margin)}</span>
      <div class="pos-total"><span class="pos-muted">Receita</span><span>${money(t.revenue)}</span></div>
      <div class="pos-total"><span class="pos-muted">Custo</span><span>${money(t.cost)}</span></div>
      <div class="pos-total"><span class="pos-muted">Vendas · unidades</span><span>${t.sales.size} · ${t.units}</span></div></div>`;
  };

  function render() {
    if (section.hidden) return;
    const sum = summarize(lines);
    const rows = breakdown(lines, mode);
    const missing = sum.month.missingCost;
    section.innerHTML = `
      <div class="section-heading"><div><p class="eyebrow">ADMINISTRADOR</p><h2>Lucro</h2></div><button type="button" class="pos-btn" data-refresh>${loading ? 'A atualizar…' : 'Atualizar'}</button></div>
      ${error ? '<p class="pos-muted">Não foi possível carregar o relatório.</p>' : ''}
      <div class="profit-grid">${card('Hoje', sum.day)}${card('Esta semana', sum.week)}${card('Este mês', sum.month)}</div>
      ${missing ? `<p class="pos-muted profit-note">${missing} linha(s) de venda deste mês sem custo definido: o lucro pode estar sobrestimado. Defina o custo por unidade na Caixa.</p>` : ''}
      <div class="pos-card" style="margin-top:12px"><div class="pos-pay" role="group" aria-label="Período do detalhe">
        ${[['day', 'Por dia'], ['week', 'Por semana'], ['month', 'Por mês']].map(([k, v]) => `<button type="button" data-mode="${k}" class="${mode === k ? 'on' : ''}" aria-pressed="${mode === k}">${v}</button>`).join('')}</div>
        <div class="profit-scroll"><table class="profit-table"><thead><tr><th>Período</th><th>Vendas</th><th>Receita</th><th>Custo</th><th>Lucro</th></tr></thead><tbody>
        ${rows.map(b => `<tr><td>${esc(label(b.from, mode))}</td><td>${b.totals.sales.size}</td><td>${money(b.totals.revenue)}</td><td>${money(b.totals.cost)}</td><td class="${b.totals.profit < 0 ? 'neg' : 'pos'}">${money(b.totals.profit)}</td></tr>`).join('')}</tbody></table></div>
        <p class="pos-muted">${cloud() ? 'Dados do servidor.' : 'Dados guardados neste dispositivo.'} Só contam vendas feitas na Caixa com preço definido. Semana de segunda a domingo.</p></div>`;
  }
  section.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { mode = b.dataset.mode; render(); }
    else if ('refresh' in b.dataset) load(true);
  });
  document.addEventListener('stock:render', () => { if (!section.hidden) load(false); });
})();
