(() => {
  const STORAGE_KEY = 'stock-loja-products-v1';
  const productList = document.querySelector('#productList');
  const productDialog = document.querySelector('#productDialog');
  const deleteDialog = document.querySelector('#deleteDialog');
  const productForm = document.querySelector('#productForm');
  const installButton = document.querySelector('#installButton');
  const installDialog = document.querySelector('#installDialog');
  const nameInput = document.querySelector('#productName');
  const quantityInput = document.querySelector('#productQuantity');
  const searchInput = document.querySelector('#searchInput');
  const importButton = document.querySelector('#importButton');
  const importInput = document.querySelector('#importInput');
  const palette = [
    ['#edf0df', '#71804c', '◈'], ['#f8e8dd', '#b47a57', '◉'], ['#e2eee8', '#4f8269', '▧'],
    ['#eee8f2', '#836b91', '✳'], ['#f5edda', '#aa8b4e', '◇'], ['#e1eaf0', '#618099', '▤']
  ];
  let products = loadProducts();
  let pendingDeleteId = null;
  let deferredInstallPrompt = null;
  let cloudRole = null;
  const SALES_KEY = 'stock-loja-sales-v1';
  function loadSales() { try { const data = JSON.parse(localStorage.getItem(SALES_KEY) || '[]'); return Array.isArray(data) ? data.filter(item => item && typeof item.name === 'string' && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0 && Number.isFinite(Date.parse(item.at))).map(item => ({name:item.name.slice(0,120), quantity:Number(item.quantity), at:new Date(item.at).toISOString()})) : []; } catch { return []; } }
  let sales = loadSales();
  const themeToggle = document.querySelector('#themeToggle');
  const savedTheme = localStorage.getItem('stock-loja-theme-v1');
  if (savedTheme === 'dark') document.body.classList.add('dark-mode');
  themeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀' : '☾';
  themeToggle.setAttribute('aria-label', document.body.classList.contains('dark-mode') ? 'Ativar modo claro' : 'Ativar modo escuro');
  themeToggle.addEventListener('click', () => { const dark = document.body.classList.toggle('dark-mode'); localStorage.setItem('stock-loja-theme-v1', dark ? 'dark' : 'light'); themeToggle.textContent = dark ? '☀' : '☾'; themeToggle.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro'); });
  document.querySelectorAll('.app-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.app-tab').forEach(item => item.classList.toggle('is-active', item === tab)); document.querySelector('#inventoryView').hidden = tab.dataset.view !== 'inventoryView'; document.querySelector('#salesView').hidden = tab.dataset.view !== 'salesView'; if (tab.dataset.view === 'salesView') refreshSales(); }));

  function loadProducts() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(Number(item.quantity))) : [];
    } catch { return []; }
  }

  function saveProducts() {
    if (cloudRole) return true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
      return true;
    } catch {
      alert('Não foi possível guardar os dados. Verifique o espaço disponível no dispositivo.');
      return false;
    }
  }

  function normalizeImportedProducts(data) {
    const rawItems = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : [];
    return rawItems
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const quantity = Number(item.quantity);
        if (!name || !Number.isFinite(quantity) || quantity < 0) return null;
        return {
          id: typeof item.id === 'string' && item.id ? item.id : (crypto.randomUUID ? crypto.randomUUID() : `imported-${Date.now()}-${index}`),
          name,
          quantity: Math.floor(quantity),
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now()
        };
      })
      .filter(Boolean);
  }

  function handleImport(event) {
    const [file] = event.target.files || [];
    if (!file) return;
    if (cloudRole) {
      alert('A importação de ficheiros está disponível apenas no modo local.');
      event.target.value = '';
      return;
    }
    const shouldReplace = window.confirm('Deseja substituir o inventário atual pela cópia de segurança selecionada?');
    if (!shouldReplace) {
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = normalizeImportedProducts(parsed);
        if (!imported.length) throw new Error('Nenhum produto válido foi encontrado neste ficheiro.');
        products = imported;
        if (saveProducts()) {
          alert('Cópia de segurança importada com sucesso.');
          render();
        }
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Não foi possível importar a cópia de segurança.');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      alert('Não foi possível ler o ficheiro. Tente novamente.');
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function render() {
    const term = searchInput.value.trim().toLocaleLowerCase('pt');
    const sort = document.querySelector('#sortSelect').value;
    const visible = products.filter(item => item.name.toLocaleLowerCase('pt').includes(term));
    if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    if (sort === 'stock-low') visible.sort((a, b) => Number(a.quantity) - Number(b.quantity));
    if (sort === 'stock-high') visible.sort((a, b) => Number(b.quantity) - Number(a.quantity));
    if (sort === 'recent') visible.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    const totalUnits = products.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
    document.querySelector('#totalUnits').textContent = totalUnits.toLocaleString('pt');
    document.querySelector('#productCount').textContent = products.length.toLocaleString('pt');
    document.querySelector('#lowCount').textContent = products.filter(item => Number(item.quantity) <= 5).length.toLocaleString('pt');
    document.querySelector('#countBadge').textContent = products.length.toLocaleString('pt');
    document.querySelector('#emptyState').hidden = products.length !== 0;
    document.querySelector('.table-wrap').hidden = products.length === 0;
    document.querySelector('#noResults').hidden = products.length === 0 || visible.length !== 0;

    productList.innerHTML = visible.map((item, index) => {
      const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
      const [bg, fg, symbol] = palette[hash(item.id) % palette.length];
      const stockClass = quantity === 0 ? 'stock-out' : quantity <= 5 ? 'stock-low' : 'stock-ok';
      const stockLabel = quantity === 0 ? 'Esgotado' : quantity <= 5 ? 'Stock baixo' : 'Disponível';
      const canManage = !cloudRole || cloudRole === 'admin';
      return `<article class="product-row ${canManage ? '' : 'user-view'}" data-id="${escapeHTML(item.id)}">
        <div class="product-info"><span class="product-avatar" style="background:${bg};color:${fg}">${symbol}</span><div><strong>${escapeHTML(item.name)}</strong><small>Produto #${String(index + 1).padStart(3, '0')}</small></div></div>
        <div class="quantity-control">${canManage ? `<button class="qty-btn" data-action="decrease" aria-label="Diminuir quantidade de ${escapeHTML(item.name)}">−</button>` : ''}<strong>${quantity.toLocaleString('pt')}</strong>${canManage ? `<button class="qty-btn" data-action="increase" aria-label="Aumentar quantidade de ${escapeHTML(item.name)}">＋</button>` : ''}</div>
        <span class="stock-tag ${stockClass}">${stockLabel}</span>
        <div class="row-actions"><button class="sold-button" data-action="sell" aria-label="Registar uma unidade vendida ou retirada de ${escapeHTML(item.name)}" title="Retirar uma unidade do stock" ${quantity === 0 ? 'disabled' : ''}>Vendido</button>${canManage ? `<button class="row-action" data-action="edit" aria-label="Editar ${escapeHTML(item.name)}" title="Editar">✎</button><button class="row-action delete" data-action="delete" aria-label="Eliminar ${escapeHTML(item.name)}" title="Eliminar">⌫</button>` : ''}</div>
      </article>`;
    }).join('');
    renderSales();
    document.dispatchEvent(new Event('stock:render'));
  }

  function renderSales() {
    const select = document.querySelector('#salesProduct');
    const current = select.value;
    select.innerHTML = '<option value="">Escolha um produto</option>' + products.map(p => `<option value="${escapeHTML(p.id)}" ${Number(p.quantity) < 1 ? 'disabled' : ''}>${escapeHTML(p.name)} — ${Math.max(0, Number(p.quantity))} em stock</option>`).join('');
    if (products.some(p => p.id === current)) select.value = current;
    document.querySelector('#salesCount').textContent = sales.length.toLocaleString('pt');
    document.querySelector('#salesUnits').textContent = sales.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('pt');
    document.querySelector('#salesHistory').innerHTML = sales.slice(0, 10).map(item => `<article class="activity-row"><span class="activity-sign is-out">−</span><div><strong>${escapeHTML(item.name)}</strong><small>${new Date(item.at).toLocaleString('pt')}</small></div><b>${Number(item.quantity).toLocaleString('pt')} un.</b></article>`).join('') || '<p class="dialog-copy">Ainda não há vendas registadas.</p>';
  }

  async function refreshSales() { if (window.StockAuth?.isCloudMode()) { const cloudSales = await window.StockAuth.loadSales(); if (cloudSales) sales = cloudSales; } renderSales(); }

  document.querySelector('#salesForm').addEventListener('submit', async event => {
    event.preventDefault();
    const product = products.find(item => item.id === document.querySelector('#salesProduct').value);
    const quantity = Math.floor(Number(document.querySelector('#salesQuantity').value));
    if (!product || quantity < 1) return;
    if (quantity > 10000) { alert('Quantidade demasiado grande para uma venda.'); return; }
    if (Number(product.quantity) < quantity) { alert('Stock insuficiente para esta venda.'); return; }
    const submitButton = document.querySelector('#salesForm button[type=submit]');
    submitButton.disabled = true;
    if (cloudRole) {
      const ok = await window.StockAuth.sell(product.id, quantity);
      if (!ok) { submitButton.disabled = false; return; }
    } else {
      product.quantity = Number(product.quantity) - quantity;
      saveProducts();
      sales.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: product.name, quantity, at: new Date().toISOString() });
      try { localStorage.setItem(SALES_KEY, JSON.stringify(sales)); } catch {}
    }
    render();
    document.querySelector('#salesForm').reset();
    submitButton.disabled = false;
    document.querySelector('#salesQuantity').value = 1;
    window.StockTabs?.open('caixa');
    alert('Venda registada com sucesso.');
  });

  function hash(value) {
    let result = 0;
    for (let i = 0; i < value.length; i++) result = ((result << 5) - result + value.charCodeAt(i)) | 0;
    return Math.abs(result);
  }

  function openForm(product = null) {
    if (cloudRole && cloudRole !== 'admin') return;
    productForm.reset();
    document.querySelector('#productId').value = product?.id || '';
    nameInput.value = product?.name || '';
    quantityInput.value = product ? Math.max(0, Math.floor(Number(product.quantity) || 0)) : 0;
    const editing = Boolean(product);
    document.querySelector('#dialogTitle').textContent = editing ? 'Editar produto' : 'Adicionar produto';
    document.querySelector('#dialogEyebrow').textContent = editing ? 'ATUALIZAR INVENTÁRIO' : 'NOVO NO INVENTÁRIO';
    document.querySelector('#saveButton').textContent = editing ? 'Guardar alterações' : 'Guardar produto';
    productDialog.showModal();
    setTimeout(() => nameInput.focus(), 50);
  }

  async function changeQuantity(id, amount) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    if (window.StockAuth?.isCloudMode()) {
      const ok = await window.StockAuth.adjustStock(product.id, amount, amount > 0 ? 'restock' : 'adjustment');
      if (ok) render();
      return;
    }
    product.quantity = Math.max(0, Math.floor(Number(product.quantity) || 0) + amount);
    saveProducts(false); render();
  }

  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImport);
  document.querySelector('#addButton').addEventListener('click', () => openForm());
  document.querySelector('#emptyAddButton').addEventListener('click', () => openForm());
  document.querySelector('#closeDialog').addEventListener('click', () => productDialog.close());
  document.querySelector('#cancelDialog').addEventListener('click', () => productDialog.close());
  document.querySelector('#quantityMinus').addEventListener('click', () => quantityInput.value = Math.max(0, Number(quantityInput.value || 0) - 1));
  document.querySelector('#quantityPlus').addEventListener('click', () => quantityInput.value = Math.max(0, Number(quantityInput.value || 0) + 1));

  productForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const quantity = Math.floor(Number(quantityInput.value));
    if (!name || !Number.isFinite(quantity) || quantity < 0) return;
    const id = document.querySelector('#productId').value;
    if (cloudRole) {
      const current = products.find(item => item.id === id);
      let ok = false;
      if (id && current) {
        ok = current.name === name || await window.StockAuth.renameProduct(id, name);
        const delta = quantity - Math.floor(Number(current.quantity) || 0);
        if (ok && delta) ok = await window.StockAuth.adjustStock(id, delta, 'adjustment');
      } else if (!id) {
        ok = await window.StockAuth.createProduct(name, quantity);
      }
      if (ok) productDialog.close();
      return;
    }
    const duplicate = products.some(item => item.id !== id && item.name.toLocaleLowerCase('pt') === name.toLocaleLowerCase('pt'));
    if (duplicate) {
      alert('Já existe um produto com este nome. Escolha outro nome para evitar duplicados no inventário.');
      nameInput.focus();
      return;
    }
    if (id) {
      const product = products.find(item => item.id === id);
      if (product) { product.name = name; product.quantity = quantity; product.updatedAt = Date.now(); }
    } else {
      products.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, quantity, createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (saveProducts()) { productDialog.close(); render(); }
  });

  productList.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-id]');
    const product = products.find(item => item.id === row?.dataset.id);
    if (!product) return;
    if (button.dataset.action === 'increase') changeQuantity(product.id, 1);
    if (button.dataset.action === 'decrease') changeQuantity(product.id, -1);
    if (button.dataset.action === 'sell') {
      if (window.StockAuth?.isCloudMode()) window.StockAuth.sell(product.id).catch(() => alert('Não foi possível registar a venda. Verifique a ligação à internet.'));
      else changeQuantity(product.id, -1);
    }
    if (button.dataset.action === 'edit' && (!cloudRole || cloudRole === 'admin')) openForm(product);
    if (button.dataset.action === 'delete') { pendingDeleteId = product.id; deleteDialog.showModal(); }
  });

  document.querySelector('#closeDelete').addEventListener('click', () => deleteDialog.close());
  document.querySelector('#keepProduct').addEventListener('click', () => deleteDialog.close());
  document.querySelector('#confirmDelete').addEventListener('click', async () => {
    if (window.StockAuth?.isCloudMode() && !await window.StockAuth.deleteProduct(pendingDeleteId)) return;
    products = products.filter(item => item.id !== pendingDeleteId);
    pendingDeleteId = null; saveProducts(false); deleteDialog.close(); render();
  });
  searchInput.addEventListener('input', render);
  document.querySelector('#sortSelect').addEventListener('change', render);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openForm(); }
  });

  document.querySelector('#backupButton').addEventListener('click', () => {
    const file = new Blob([JSON.stringify({ app: 'Stock', version: 1, exportedAt: new Date().toISOString(), products }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url; link.download = `stock-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
  });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  installButton.hidden = isInstalled;

  function showInstallHelp() {
    const instructions = document.querySelector('#installInstructions');
    const confirmButton = document.querySelector('#confirmInstall');
    if (isIOS) {
      instructions.textContent = 'No iPhone ou iPad, abra esta página no Safari, toque em Partilhar e escolha “Adicionar ao ecrã principal”. Deixe ativa a opção “Abrir como app web” e toque em Adicionar.';
      confirmButton.hidden = true;
    } else if (isAndroid && deferredInstallPrompt) {
      instructions.textContent = 'Confirme a instalação para adicionar o Stock ao ecrã inicial e à lista de apps.';
      confirmButton.hidden = false;
    } else if (isAndroid) {
      instructions.textContent = 'No Chrome para Android, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar ao ecrã inicial”.';
      confirmButton.hidden = true;
    } else {
      instructions.textContent = 'Abra este endereço no Safari de um iPhone ou no Chrome de um Android e siga as instruções de instalação.';
      confirmButton.hidden = true;
    }
    installDialog.showModal();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
  installButton.addEventListener('click', showInstallHelp);
  document.querySelector('#closeInstall').addEventListener('click', () => installDialog.close());
  document.querySelector('#dismissInstall').addEventListener('click', () => installDialog.close());
  document.querySelector('#confirmInstall').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installDialog.close();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
  const dateLabel = new Intl.DateTimeFormat('pt', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  document.querySelector('#todayLabel').textContent = dateLabel.toLocaleUpperCase('pt');
  window.StockApp = {
    setCloudRole(role) { cloudRole = role; importButton.hidden = Boolean(role); render(); },
    replaceProducts(items) { products = items; render(); },
    clearProducts() { products = []; saveProducts(false); render(); },
    getLocalProducts() { return loadProducts(); },
    getProducts() { return products; },
    setSales(items) { sales = items; renderSales(); },
    restoreLocal() { cloudRole = null; products = loadProducts(); sales = loadSales(); render(); },
    applyLocalSale(lines) {
      for (const line of lines) {
        const product = products.find(item => item.id === line.id);
        if (!product || Number(product.quantity) < line.quantity) return false;
      }
      const at = new Date().toISOString();
      for (const line of lines) {
        const product = products.find(item => item.id === line.id);
        product.quantity = Number(product.quantity) - line.quantity;
        sales.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: product.name, quantity: line.quantity, at });
      }
      saveProducts();
      try { localStorage.setItem(SALES_KEY, JSON.stringify(sales.slice(0, 200))); } catch {}
      render();
      return true;
    }
  };
  render();
})();
