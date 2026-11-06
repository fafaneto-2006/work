(() => {
  const STORAGE_KEY = 'stock-loja-products-v1';
  const productList = document.querySelector('#productList');
  const productDialog = document.querySelector('#productDialog');
  const deleteDialog = document.querySelector('#deleteDialog');
  const productForm = document.querySelector('#productForm');
  const nameInput = document.querySelector('#productName');
  const quantityInput = document.querySelector('#productQuantity');
  const searchInput = document.querySelector('#searchInput');
  const palette = [
    ['#edf0df', '#71804c', '◈'], ['#f8e8dd', '#b47a57', '◉'], ['#e2eee8', '#4f8269', '▧'],
    ['#eee8f2', '#836b91', '✳'], ['#f5edda', '#aa8b4e', '◇'], ['#e1eaf0', '#618099', '▤']
  ];
  let products = loadProducts();
  let pendingDeleteId = null;

  function loadProducts() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(Number(item.quantity))) : [];
    } catch { return []; }
  }

  function saveProducts() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
      return true;
    } catch {
      alert('Não foi possível guardar os dados. Verifique o espaço disponível no dispositivo.');
      return false;
    }
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
      return `<article class="product-row" data-id="${escapeHTML(item.id)}">
        <div class="product-info"><span class="product-avatar" style="background:${bg};color:${fg}">${symbol}</span><div><strong>${escapeHTML(item.name)}</strong><small>Produto #${String(index + 1).padStart(3, '0')}</small></div></div>
        <div class="quantity-control"><button class="qty-btn" data-action="decrease" aria-label="Diminuir quantidade de ${escapeHTML(item.name)}">−</button><strong>${quantity.toLocaleString('pt')}</strong><button class="qty-btn" data-action="increase" aria-label="Aumentar quantidade de ${escapeHTML(item.name)}">＋</button></div>
        <span class="stock-tag ${stockClass}">${stockLabel}</span>
        <div class="row-actions"><button class="row-action" data-action="edit" aria-label="Editar ${escapeHTML(item.name)}" title="Editar">✎</button><button class="row-action delete" data-action="delete" aria-label="Eliminar ${escapeHTML(item.name)}" title="Eliminar">⌫</button></div>
      </article>`;
    }).join('');
  }

  function hash(value) {
    let result = 0;
    for (let i = 0; i < value.length; i++) result = ((result << 5) - result + value.charCodeAt(i)) | 0;
    return Math.abs(result);
  }

  function openForm(product = null) {
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

  function changeQuantity(id, amount) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    product.quantity = Math.max(0, Math.floor(Number(product.quantity) || 0) + amount);
    saveProducts(); render();
  }

  document.querySelector('#addButton').addEventListener('click', () => openForm());
  document.querySelector('#emptyAddButton').addEventListener('click', () => openForm());
  document.querySelector('#closeDialog').addEventListener('click', () => productDialog.close());
  document.querySelector('#cancelDialog').addEventListener('click', () => productDialog.close());
  document.querySelector('#quantityMinus').addEventListener('click', () => quantityInput.value = Math.max(0, Number(quantityInput.value || 0) - 1));
  document.querySelector('#quantityPlus').addEventListener('click', () => quantityInput.value = Math.max(0, Number(quantityInput.value || 0) + 1));

  productForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const quantity = Math.floor(Number(quantityInput.value));
    if (!name || !Number.isFinite(quantity) || quantity < 0) return;
    const id = document.querySelector('#productId').value;
    if (id) {
      const product = products.find(item => item.id === id);
      if (product) { product.name = name; product.quantity = quantity; product.updatedAt = Date.now(); }
    } else {
      products.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, quantity, createdAt: Date.now() });
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
    if (button.dataset.action === 'edit') openForm(product);
    if (button.dataset.action === 'delete') { pendingDeleteId = product.id; deleteDialog.showModal(); }
  });

  document.querySelector('#closeDelete').addEventListener('click', () => deleteDialog.close());
  document.querySelector('#keepProduct').addEventListener('click', () => deleteDialog.close());
  document.querySelector('#confirmDelete').addEventListener('click', () => {
    products = products.filter(item => item.id !== pendingDeleteId);
    pendingDeleteId = null; saveProducts(); deleteDialog.close(); render();
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
  const dateLabel = new Intl.DateTimeFormat('pt', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  document.querySelector('#todayLabel').textContent = dateLabel.toLocaleUpperCase('pt');
  render();
})();
