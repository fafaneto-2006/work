(() => {
  const app = window.StockApp;
  if (!app) return;
  const PRICE_KEY = 'stock-loja-prices-v1';
  const SEQ_KEY = 'stock-loja-invoice-seq-v1';
  const COST_KEY = 'stock-loja-costs-v1';
  const LEDGER_KEY = 'stock-loja-ledger-v1';
  const MINUS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  const PAY = { cash:'Dinheiro', card:'Cartão', transfer:'Transferência' };
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = c => 'STN ' + (Number(c) / 100).toLocaleString('pt', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const cloud = () => Boolean(window.StockAuth?.isCloudMode());
  const isAdmin = () => window.StockAuth?.getRole() === 'admin';
  let prices = loadPrices();
  let localCosts = loadMap(COST_KEY);
  let cloudCosts = {};
  let costsLoaded = false;
  let cart = new Map();
  let payment = 'cash';
  let busy = false;
  let pendingReq = null;
  let query = '';
  let lastDoc = null;

  function loadPrices() {
    try {
      const v = JSON.parse(localStorage.getItem(PRICE_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }
  function loadMap(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }
  function loadLedger() {
    try { const v = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  const costOf = p => {
    const c = cloud() ? cloudCosts[p.id] : localCosts[p.id];
    return Number.isInteger(c) && c >= 0 ? c : null;
  };
  async function ensureCosts() {
    if (!cloud() || !isAdmin()) { costsLoaded = false; return; }
    if (costsLoaded) return;
    costsLoaded = true;
    cloudCosts = await window.StockAuth.loadCosts();
    renderPOS();
  }
  function savePrices() { try { localStorage.setItem(PRICE_KEY, JSON.stringify(prices)); } catch {} }
  function nextLocalNumber() {
    let n = 0;
    try { n = Number(localStorage.getItem(SEQ_KEY)) || 0; localStorage.setItem(SEQ_KEY, String(n + 1)); } catch {}
    return n + 1;
  }
  const priceOf = p => {
    const c = cloud() ? p.priceCents : prices[p.id];
    return Number.isInteger(c) && c >= 0 ? c : null;
  };

  // ----- estrutura (injetada; não depende do HTML existente)
  const section = document.createElement('section');
  section.id = 'posView'; section.className = 'pos-section'; section.hidden = true;
  document.querySelector('#salesView').after(section);
  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="pos-dialog" id="posCustomerDialog"><form id="posCustomerForm" method="dialog">
      <h2>Emitir fatura</h2><p class="pos-muted">Dados do cliente. A venda é registada ao emitir.</p>
      <label for="posCustName" class="pos-muted">Nome do cliente</label><input class="pos-field" id="posCustName" maxlength="120" required />
      <label for="posCustNif" class="pos-muted">NIF (opcional)</label><input class="pos-field" id="posCustNif" maxlength="20" pattern="[A-Za-z0-9 .\\-]{1,20}" />
      <div class="pos-actions" style="margin-top:12px"><button type="button" id="posCustCancel">Cancelar</button><button class="pos-primary" type="submit">Emitir fatura</button></div>
    </form></dialog>
    <dialog class="pos-dialog" id="posDocDialog"><div class="pos-doc" id="posDoc"></div>
      <div class="pos-actions pos-noprint" style="margin-top:12px"><button type="button" id="posDocClose">Fechar</button><button class="pos-primary" type="button" id="posDocPrint">Imprimir</button></div></dialog>`);
  const custDialog = document.querySelector('#posCustomerDialog');
  const docDialog = document.querySelector('#posDocDialog');

  document.addEventListener('stock:render', () => {
    for (const id of [...cart.keys()]) { if (!app.getProducts().some(p => p.id === id)) cart.delete(id); }
    if (!section.hidden) renderPOS();
  });

  // ----- carrinho
  const resetReq = () => { pendingReq = null; };
  function cartLines() {
    return [...cart].map(([id, quantity]) => {
      const p = app.getProducts().find(x => x.id === id);
      const unit = p ? priceOf(p) : null;
      return p && unit !== null ? { id, name:p.name, quantity, unit, total:unit * quantity } : null;
    }).filter(Boolean);
  }
  function add(id) {
    const p = app.getProducts().find(x => x.id === id);
    if (!p) return;
    if (priceOf(p) === null) { alert('Defina o preço deste produto em "Definir preços".'); return; }
    const q = cart.get(id) || 0;
    if (q + 1 > Number(p.quantity)) { alert('Stock insuficiente.'); return; }
    cart.set(id, q + 1); resetReq(); renderPOS();
  }
  function change(id, delta) {
    const p = app.getProducts().find(x => x.id === id);
    const q = (cart.get(id) || 0) + delta;
    if (q <= 0) cart.delete(id);
    else if (p && q <= Number(p.quantity)) cart.set(id, q);
    else alert('Stock insuficiente.');
    resetReq(); renderPOS();
  }

  // ----- ecrã
  function renderPOS() {
    const products = app.getProducts();
    const term = query.trim().toLocaleLowerCase('pt');
    const shown = products.filter(p => p.name.toLocaleLowerCase('pt').includes(term)).slice(0, 24);
    const lines = cartLines();
    const total = lines.reduce((s, l) => s + l.total, 0);
    const count = lines.reduce((s, l) => s + l.quantity, 0);
    const canEditPrice = !cloud() || isAdmin();
    const showCost = !cloud() || isAdmin();
    ensureCosts();
    section.innerHTML = `
      <div class="pos-card">
        <h3>Produtos</h3>
        <input class="pos-field" id="posSearch" type="search" placeholder="Procurar produto..." aria-label="Procurar produto" value="${esc(query)}" />
        <div class="pos-tiles">${shown.length ? shown.map(p => {
          const pr = priceOf(p); const out = Number(p.quantity) <= 0;
          return `<button type="button" class="pos-tile" data-add="${esc(p.id)}" ${out ? 'disabled' : ''}><strong>${esc(p.name)}</strong><span>${pr === null ? 'Sem preço' : money(pr)} · ${out ? 'esgotado' : esc(p.quantity) + ' em stock'}</span></button>`;
        }).join('') : '<p class="pos-muted">Nenhum produto encontrado.</p>'}</div>
      </div>
      <div class="pos-card">
        <h3>Carrinho · ${count} ${count === 1 ? 'artigo' : 'artigos'}</h3>
        <div>${lines.length ? lines.map(l => `<div class="pos-line"><div><strong>${esc(l.name)}</strong><div class="pos-muted">${money(l.unit)}</div></div><div class="pos-qty"><button type="button" data-dec="${esc(l.id)}" aria-label="Diminuir ${esc(l.name)}">${MINUS}</button><strong>${l.quantity}</strong><button type="button" data-inc="${esc(l.id)}" aria-label="Aumentar ${esc(l.name)}">+</button></div><strong>${money(l.total)}</strong></div>`).join('') : '<p class="pos-muted">Toque num produto para o adicionar.</p>'}</div>
        <div class="pos-total big"><span>Total</span><span>${money(total)}</span></div>
        <div class="pos-pay" role="group" aria-label="Forma de pagamento">${Object.entries(PAY).map(([k, v]) => `<button type="button" data-pay="${k}" class="${payment === k ? 'on' : ''}" aria-pressed="${payment === k}">${v}</button>`).join('')}</div>
        <div class="pos-actions"><button type="button" data-clear ${lines.length && !busy ? '' : 'disabled'}>Limpar</button><button type="button" class="pos-primary" data-charge ${lines.length && !busy ? '' : 'disabled'}>${busy ? 'A processar…' : 'Cobrar ' + money(total)}</button></div>
        <button type="button" class="pos-btn" data-invoice ${lines.length && !busy ? '' : 'disabled'}>Emitir fatura</button>
      </div>
      <div class="pos-card pos-wide">
        <h3>Preço por unidade</h3>
        <p class="pos-muted">Defina o preço de venda${showCost ? ' e o custo' : ''} de cada unidade.${showCost ? ' Lucro = (venda − custo) × quantidade vendida.' : ''}${canEditPrice ? '' : ' Só administradores podem alterar.'}</p>
        <div class="pr-table ${showCost ? '' : 'no-cost'}">
          <div class="pr-row pr-head"><span>Produto</span>${showCost ? '<span>Custo/un.</span>' : ''}<span>Venda/un.</span>${showCost ? '<span class="pr-margin">Margem</span>' : ''}</div>
          ${products.map(p => { const pr = priceOf(p), co = costOf(p); const m = pr && co !== null && pr > 0 ? Math.round((pr - co) / pr * 100) + '%' : '—';
            return `<label class="pr-row"><span>${esc(p.name)}</span>${showCost ? `<input type="number" min="0" step="0.01" inputmode="decimal" data-cost="${esc(p.id)}" value="${co === null ? '' : (co / 100).toFixed(2)}" ${canEditPrice ? '' : 'disabled'} aria-label="Custo de ${esc(p.name)}" />` : ''}<input type="number" min="0" step="0.01" inputmode="decimal" data-price="${esc(p.id)}" value="${pr === null ? '' : (pr / 100).toFixed(2)}" ${canEditPrice ? '' : 'disabled'} aria-label="Preço de venda de ${esc(p.name)}" />${showCost ? `<span class="pr-margin pos-muted">${m}</span>` : ''}</label>`; }).join('')}
        </div>
      </div>`;
    const search = section.querySelector('#posSearch');
    search.addEventListener('input', () => { query = search.value; const pos = search.selectionStart; renderPOS(); const s2 = section.querySelector('#posSearch'); s2.focus(); s2.setSelectionRange(pos, pos); });
  }

  section.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.add) add(t.dataset.add);
    else if (t.dataset.inc) change(t.dataset.inc, 1);
    else if (t.dataset.dec) change(t.dataset.dec, -1);
    else if (t.dataset.pay) { payment = t.dataset.pay; resetReq(); renderPOS(); }
    else if ('clear' in t.dataset) { cart.clear(); resetReq(); renderPOS(); }
    else if ('charge' in t.dataset) finish(null);
    else if ('invoice' in t.dataset) { document.querySelector('#posCustomerForm').reset(); custDialog.showModal(); }
  });
  section.addEventListener('change', async e => {
    const idP = e.target.dataset?.price, idC = e.target.dataset?.cost;
    const id = idP || idC; if (!id) return;
    const raw = e.target.value.trim();
    if (raw === '') return;
    const cents = Math.round(Number(raw.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > 100000000) { alert('Valor inválido.'); renderPOS(); return; }
    if (idC) {
      if (cloud()) { if (await window.StockAuth.setCost(id, cents)) cloudCosts[id] = cents; }
      else { localCosts[id] = cents; try { localStorage.setItem(COST_KEY, JSON.stringify(localCosts)); } catch {} }
      renderPOS(); return;
    }
    if (cloud()) { if (!(await window.StockAuth.setPrice(id, cents))) renderPOS(); }
    else { prices[id] = cents; savePrices(); renderPOS(); }
  });

  // ----- cobrança / fatura
  async function finish(customer) {
    if (busy || !cart.size) return;
    const lines = cartLines();
    if (lines.length !== cart.size) { alert('Há artigos sem preço no carrinho.'); return; }
    const snapshot = { items:lines, total:lines.reduce((s, l) => s + l.total, 0), payment, at:new Date().toISOString(), customer, invoice:null };
    busy = true; renderPOS();
    try {
      if (cloud()) {
        pendingReq = pendingReq || crypto.randomUUID();
        const res = await window.StockAuth.checkout(lines.map(l => ({ id:l.id, quantity:l.quantity })), payment, pendingReq);
        if (!res.ok) { if (res.definitive) resetReq(); return; }
        resetReq();
        if (customer) {
          snapshot.invoice = await window.StockAuth.issueInvoice(res.id, customer.name, customer.nif);
          if (!snapshot.invoice) alert('Venda registada, mas a fatura não foi emitida. Tente emitir novamente mais tarde.');
        }
      } else {
        if (!app.applyLocalSale(lines.map(l => ({ id:l.id, quantity:l.quantity })))) { alert('Stock insuficiente para esta venda.'); return; }
        const saleId = crypto.randomUUID();
        const ledger = loadLedger();
        for (const l of lines) { const c = localCosts[l.id]; ledger.push({ sale:saleId, at:snapshot.at, name:l.name, quantity:l.quantity, unit:l.unit, cost:Number.isInteger(c) ? c : null }); }
        try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(-5000))); } catch {}
        if (customer) snapshot.invoice = { number:nextLocalNumber(), issued_at:snapshot.at };
      }
      cart.clear();
      showDoc(snapshot);
    } catch { alert('Não foi possível concluir a venda. Verifique a ligação à internet.'); }
    finally { busy = false; renderPOS(); }
  }
  document.querySelector('#posCustomerForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.querySelector('#posCustName').value.trim();
    const nif = document.querySelector('#posCustNif').value.trim();
    if (!name) return;
    custDialog.close();
    finish({ name, nif });
  });
  document.querySelector('#posCustCancel').addEventListener('click', () => custDialog.close());
  function showDoc(d) {
    lastDoc = d;
    const when = new Date(d.invoice?.issued_at || d.at).toLocaleString('pt');
    const title = d.invoice ? `Fatura FT ${new Date(d.invoice.issued_at || d.at).getFullYear()}/${String(d.invoice.number).padStart(4, '0')}` : 'Recibo de venda';
    document.querySelector('#posDoc').innerHTML = `
      <h2>${esc(title)}</h2><div class="pos-muted">${esc(when)}</div>
      ${d.customer ? `<p>Cliente: <strong>${esc(d.customer.name)}</strong>${d.customer.nif ? ` · NIF ${esc(d.customer.nif)}` : ''}</p>` : ''}
      <hr><table><thead><tr><th>Artigo</th><th>Qtd.</th><th>Total</th></tr></thead><tbody>
      ${d.items.map(l => `<tr><td>${esc(l.name)}<div class="pos-muted">${esc(money(l.unit))}</div></td><td>${esc(l.quantity)}</td><td>${esc(money(l.total))}</td></tr>`).join('')}</tbody></table>
      <hr><div class="pos-total big"><span>Total</span><span>${esc(money(d.total))}</span></div>
      <p class="pos-muted">Pagamento: ${esc(PAY[d.payment])}</p>
      <p class="pos-muted">Documento gerado pelo app Stock. Não substitui uma fatura certificada: confirme os requisitos fiscais locais.</p>`;
    docDialog.showModal();
  }
  document.querySelector('#posDocClose').addEventListener('click', () => docDialog.close());
  document.querySelector('#posDocPrint').addEventListener('click', () => window.print());
})();
