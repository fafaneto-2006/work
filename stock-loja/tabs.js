(() => {
  const main = document.querySelector('.app-shell');
  const header = main.querySelector('.topbar');
  const footer = main.querySelector('.footer');
  const make = (id, cls = '') => { const s = document.createElement('section'); s.id = id; s.className = 'view ' + cls; s.hidden = true; return s; };

  // Início: boas-vindas, resumo e atalhos
  const home = make('homeView');
  home.append(main.querySelector('#inicio'), main.querySelector('.stats-grid'));
  home.insertAdjacentHTML('beforeend', `<div class="home-links">
    <button type="button" data-go="inventario"><strong>Inventário</strong><span>Ver, procurar e editar produtos</span></button>
    <button type="button" data-go="caixa"><strong>Caixa e vendas</strong><span>Vender, cobrar, emitir fatura e ver vendas</span></button>
    <button type="button" data-go="lucro"><strong>Lucro</strong><span>Lucro diário, semanal e mensal</span></button>
    <button type="button" data-go="conta"><strong>Conta</strong><span>Entrar, perfil e sessão</span></button></div>`);
  main.querySelector('#inventoryView').before(home);
  home.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) location.hash = b.dataset.go; });

  // Equipa, Movimentos e Conta: movem-se os nós do antigo diálogo (mantêm IDs e listeners)
  const dlg = document.querySelector('#accountDialog');
  const adminUsers = dlg.querySelector('#adminUsers');
  const activityHeading = adminUsers.querySelector('.activity-heading');
  const activityList = adminUsers.querySelector('#activityList');
  activityHeading?.remove();

  const history = make('historyView');
  history.innerHTML = '<div class="section-heading"><div><p class="eyebrow">ADMINISTRADOR</p><h2>Movimentos de stock</h2></div></div>';
  history.append(activityList);
  const team = make('teamView');
  team.innerHTML = '<div class="section-heading"><div><p class="eyebrow">ADMINISTRADOR</p><h2>Equipa e acessos</h2></div></div>';
  team.append(adminUsers);
  const account = make('accountView', 'account-card');
  account.append(...dlg.childNodes);
  footer.before(team, history, account);

  // Caixa + Vendas numa só tela
  const posSection = document.getElementById('posView');
  const salesOld = document.getElementById('salesView');
  posSection.hidden = false;
  const cashier = make('cashierView');
  cashier.innerHTML = '<div class="section-heading"><div><p class="eyebrow">PONTO DE VENDA</p><h2>Caixa e vendas</h2></div></div>';
  const salesBlock = document.createElement('div');
  salesBlock.className = 'sales-block';
  salesBlock.append(salesOld.querySelector('.sales-metrics'), salesOld.querySelector('.activity-heading'), salesOld.querySelector('#salesHistory'));
  cashier.append(posSection, salesBlock);
  salesOld.before(cashier);
  salesOld.hidden = true; // formulário antigo fica oculto (substituído pelo carrinho)

  const isAdmin = () => !adminUsers.hidden;
  const tabs = [
    { hash:'inicio', view:'homeView', label:'Início' },
    { hash:'inventario', view:'inventoryView', label:'Inventário' },
    { hash:'caixa', view:'cashierView', label:'Caixa', alias:'vendas' },
    { hash:'lucro', view:'profitView', label:'Lucro', when:() => !(window.StockAuth?.isCloudMode()) || isAdmin() },
    { hash:'equipa', view:'teamView', label:'Equipa', admin:true },
    { hash:'movimentos', view:'historyView', label:'Movimentos', admin:true },
    { hash:'conta', view:'accountView', label:'Conta' }
  ];
  const nav = document.createElement('nav');
  nav.className = 'stock-tabs'; nav.setAttribute('aria-label', 'Funções da loja');
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t.label; b.dataset.tab = t.hash;
    b.addEventListener('click', () => { if (location.hash === '#' + t.hash) show(t.hash); else location.hash = t.hash; });
    t.button = b; nav.append(b);
  });
  header.after(nav);

  let current = null;
  function allowed(t) { if (!t) return false; if (t.when) return t.when(); return !t.admin || isAdmin(); }
  function refreshTabs() {
    tabs.forEach(x => { x.button.hidden = !allowed(x); });
    if (current && !allowed(current)) show('inicio');
  }
  function show(hash) {
    let t = tabs.find(x => x.hash === hash || x.alias === hash);
    if (!allowed(t)) t = tabs[0];
    current = t;
    tabs.forEach(x => {
      const el = document.getElementById(x.view);
      if (el) el.hidden = x !== t;
      x.button.hidden = !allowed(x);
      if (x === t) x.button.setAttribute('aria-current', 'page'); else x.button.removeAttribute('aria-current');
    });
    document.dispatchEvent(new Event('stock:render'));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  document.addEventListener('stock:render', refreshTabs);
  new MutationObserver(() => show(current ? current.hash : 'inicio')).observe(adminUsers, { attributes:true, attributeFilter:['hidden'] });
  window.StockTabs = { open(name) { const t = tabs.find(x => x.hash === name || x.view === name || x.alias === name); if (t) location.hash = t.hash; } };
  show(location.hash.slice(1));
})();
