(() => {
  const config = window.STOCK_SUPABASE_CONFIG;
  const sdk = window.supabase;
  const client = config && sdk?.createClient ? sdk.createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce' } }) : null;
  const dialog = document.querySelector('#accountDialog');
  const form = document.querySelector('#authForm');
  const error = document.querySelector('#authError');
  const status = document.querySelector('#accountStatus');
  const toast = document.querySelector('#loginToast');
  const accountButton = document.querySelector('#accountButton');
  const nameInput = document.querySelector('#authName');
  const nameLabel = document.querySelector('#nameLabel');
  const emailInput = document.querySelector('#authEmail');
  const passwordInput = document.querySelector('#authPassword');
  const adminUsers = document.querySelector('#adminUsers');
  const userList = document.querySelector('#userList');
  const adminPreview = document.querySelector('#adminPreview');
  const previewButton = document.querySelector('#previewAdminButton');
  let session = null;
  let profile = null;
  let signupMode = false;
  let previewMode = false;
  let recoveryMode = false;
  let teamUsers = [];
  let toastTimer;
  let inventoryChannel = null;
  let inventoryChannelUserId = null;

  function showToast(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('is-error', isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  }
  function message(text = '', isError = false) {
    error.hidden = !text || !isError;
    error.textContent = isError ? text : '';
    if (text && !isError) status.textContent = text;
    if (text && isError) showToast(text, true);
  }
  function role() { return profile?.approved ? profile.role : 'pending'; }
  function cloudMode() { return Boolean(client && session && profile?.approved); }
  function callbackUrl() { return `${location.origin}${location.pathname}`; }
  function show() { if (window.StockTabs) window.StockTabs.open('conta'); else dialog.showModal(); }
  function updateUI() {
    const signedIn = Boolean(session);
    accountButton.textContent = signedIn ? (profile?.role === 'admin' ? 'Admin' : 'Minha conta') : 'Entrar';
    document.querySelector('#accountTitle').textContent = recoveryMode ? 'Recuperar conta' : signedIn ? (profile?.role === 'admin' ? 'Painel do administrador' : 'Conta de utilizador') : (signupMode ? 'Criar conta' : 'Entrar na loja');
    form.hidden = signedIn || !client || previewMode || recoveryMode;
    document.querySelector('#passwordRecovery').hidden = !recoveryMode;
    nameInput.hidden = !signupMode || signedIn || !client;
    nameLabel.hidden = nameInput.hidden;
    nameInput.required = signupMode && !signedIn;
    document.querySelector('#passwordLabel').hidden = false;
    passwordInput.hidden = false;
    passwordInput.required = true;
    passwordInput.minLength = signupMode ? 10 : 1;
    passwordInput.placeholder = signupMode ? 'Mínimo de 10 caracteres' : 'Senha';
    passwordInput.autocomplete = signupMode ? 'new-password' : 'current-password';
    document.querySelector('#toggleAuthMode').hidden = signedIn || !client || recoveryMode;
    document.querySelector('#toggleAuthMode').textContent = signupMode ? 'Já tenho conta' : 'Criar conta';
    document.querySelector('#authSubmit').textContent = signupMode ? 'Criar conta' : 'Entrar';
    document.querySelector('#forgotPassword').hidden = signedIn || signupMode || !client || recoveryMode;
    document.querySelector('#emailLinkButton').hidden = signedIn || signupMode || !client || recoveryMode;
    document.querySelectorAll('.oauth-button').forEach(button => { button.hidden = signedIn || !client || recoveryMode; });
    document.querySelector('#signOutButton').hidden = !signedIn;
    adminUsers.hidden = !(signedIn && profile?.role === 'admin' && profile?.approved);
    adminPreview.hidden = !previewMode;
    previewButton.hidden = signedIn || !client || previewMode || recoveryMode;
    if (!client) status.textContent = 'Login precisa de internet. O inventário local continua disponível offline.';
    else if (recoveryMode) status.textContent = 'Defina uma nova senha para recuperar o acesso à sua conta.';
    else if (!signedIn) status.textContent = 'Entre para sincronizar o inventário. Pode continuar a usar o app localmente sem conta.';
    else if (!profile) status.textContent = 'A carregar o seu perfil…';
    else if (!profile.approved) status.textContent = 'Conta criada. Aguarde aprovação do administrador para aceder ao inventário partilhado.';
    else if (profile.role === 'admin') status.textContent = 'Administrador ativo: gere equipa, produtos e histórico do stock.';
    else status.textContent = 'Utilizador ativo: consulte o stock e registe produtos vendidos.';
    document.querySelector('#addButton').hidden = cloudMode() && role() !== 'admin';
    document.querySelector('#emptyAddButton').hidden = cloudMode() && role() !== 'admin';
    if (window.StockApp) window.StockApp.setCloudRole(cloudMode() ? profile.role : null);
  }

  let importDeclined = false;
  async function loadInventory() {
    if (!cloudMode()) return;
    const { data, error: queryError } = await client.from('products').select('id,name,quantity,price_cents,created_at,updated_at').order('created_at', { ascending: false });
    if (queryError) { message(queryError.message, true); return; }
    if ((!data || data.length === 0) && profile.role === 'admin' && !importDeclined) {
      const localItems = window.StockApp?.getLocalProducts() || [];
      if (localItems.length) {
        if (confirm(`Importar ${localItems.length} produto(s) guardados neste dispositivo para o inventário partilhado?`)) { await importLocal(localItems); return; }
        importDeclined = true;
      }
    }
    window.StockApp?.replaceProducts((data || []).map(p => ({ id:p.id, name:p.name, quantity:p.quantity, priceCents:p.price_cents, createdAt:Date.parse(p.created_at) || Date.now(), updatedAt:Date.parse(p.updated_at) || Date.now() })));
    await loadSales();
  }

  async function loadSales() {
    if (!cloudMode()) return;
    const { data, error: salesError } = await client.from('stock_movements').select('id,quantity_delta,created_at,product_name').eq('movement_type', 'sale').order('created_at', { ascending:false }).limit(200);
    if (salesError) return;
    window.StockApp?.setSales((data || []).map(m => ({ id:m.id, name:m.product_name || 'Produto removido', quantity:Math.abs(m.quantity_delta), at:m.created_at })));
  }

  async function loadUsers() {
    if (adminUsers.hidden) return;
    const { data, error: queryError } = await client.from('profiles').select('id,email,display_name,role,approved,created_at').order('created_at');
    if (queryError) { message(queryError.message, true); return; }
    teamUsers = data || [];
    document.querySelector('#teamTotal').textContent = teamUsers.length;
    document.querySelector('#teamPending').textContent = teamUsers.filter(user => !user.approved).length;
    document.querySelector('#teamApproved').textContent = teamUsers.filter(user => user.approved).length;
    renderUsers();
    await loadActivity();
  }
  function renderUsers() {
    const term = document.querySelector('#teamSearch').value.trim().toLocaleLowerCase('pt');
    const visible = teamUsers.filter(user => `${user.email} ${user.display_name}`.toLocaleLowerCase('pt').includes(term));
    userList.innerHTML = visible.map(user => {
      const isSelf = user.id === session?.user.id;
      return `<article class="team-user" data-user="${user.id}" data-approved="${user.approved}"><div class="team-person"><strong>${escapeHTML(user.display_name || user.email)}</strong><small>${escapeHTML(user.email)} · ${user.approved ? escapeHTML(user.role) : 'Pendente'}${isSelf ? ' · Você' : ''}</small></div><div class="team-actions"><select aria-label="Perfil de ${escapeHTML(user.email)}" ${isSelf ? 'disabled' : ''}><option value="user" ${user.role === 'user' ? 'selected' : ''}>Utilizador</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select><button class="secondary-button" data-action="save-role" ${isSelf ? 'disabled' : ''}>Guardar</button><button class="secondary-button" data-action="toggle-access" ${isSelf ? 'disabled' : ''}>${user.approved ? 'Bloquear' : 'Aprovar'}</button><button class="secondary-button recovery-user" data-action="send-reset" ${isSelf || !user.email ? 'disabled' : ''}>Enviar recuperação</button></div></article>`;
    }).join('') || '<p class="dialog-copy">Nenhuma conta encontrada.</p>';
  }
  async function loadActivity() {
    const activityList = document.querySelector('#activityList');
    const { data, error: activityError } = await client.from('stock_movements').select('id,movement_type,quantity_delta,quantity_before,quantity_after,created_at,product_name,profiles!stock_movements_user_id_fkey(display_name,email)').order('created_at', { ascending:false }).limit(12);
    if (activityError) { activityList.innerHTML = `<p class="dialog-copy">${escapeHTML(activityError.message)}</p>`; return; }
    activityList.innerHTML = (data || []).map(movement => `<article class="activity-row"><span class="activity-sign ${movement.quantity_delta < 0 ? 'is-out' : ''}">${movement.quantity_delta < 0 ? '−' : '+'}</span><div><strong>${escapeHTML(movement.product_name || 'Produto removido')}</strong><small>${escapeHTML(movement.profiles?.display_name || movement.profiles?.email || 'Equipa')} · ${new Date(movement.created_at).toLocaleString('pt')}</small></div><b>${Math.abs(movement.quantity_delta)} un.</b></article>`).join('') || '<p class="dialog-copy">Ainda não há movimentos registados.</p>';
  }
  function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  let reloadTimer;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadInventory(), 400); }
  async function clearInventoryChannel() {
    const channel = inventoryChannel;
    inventoryChannel = null;
    inventoryChannelUserId = null;
    if (channel) await client.removeChannel(channel);
  }

  async function refreshSession(nextSession) {
    session = nextSession;
    profile = null;
    importDeclined = false;
    if (session && client) {
      const { data } = await client.from('profiles').select('id,email,display_name,role,approved').eq('id', session.user.id).maybeSingle();
      profile = data || null;
    }
    updateUI();
    if (cloudMode()) {
      await loadInventory();
      await loadUsers();
      if (!inventoryChannel || inventoryChannelUserId !== session.user.id) {
        await clearInventoryChannel();
        inventoryChannelUserId = session.user.id;
        inventoryChannel = client.channel(`stock-products-${session.user.id}`).on('postgres_changes', { event:'*', schema:'public', table:'products' }, scheduleReload).subscribe();
      }
    } else {
      await clearInventoryChannel();
      window.StockApp?.restoreLocal();
    }
  }
  async function refreshProfile() {
    if (!session || !client) return;
    const { data } = await client.from('profiles').select('id,email,display_name,role,approved').eq('id', session.user.id).maybeSingle();
    profile = data || null;
    updateUI();
    if (!profile?.approved) clearLocalCache();
    if (cloudMode()) await loadInventory(); else { await clearInventoryChannel(); window.StockApp?.restoreLocal(); }
  }
  const pendingSales = new Map();
  async function sell(productId, quantity = 1) {
    if (!cloudMode()) return false;
    const key = `${productId}:${quantity}`;
    if (!pendingSales.has(key)) pendingSales.set(key, crypto.randomUUID());
    const { error: rpcError } = await client.rpc('record_sale', { p_product_id: productId, p_quantity: quantity, p_request_id: pendingSales.get(key) });
    if (rpcError) { if (rpcError.code) pendingSales.delete(key); message(rpcError.message, true); return false; }
    pendingSales.delete(key);
    await loadInventory();
    return true;
  }
  async function adminRpc(name, args) {
    if (!cloudMode() || profile.role !== 'admin') return false;
    const { error: rpcError } = await client.rpc(name, args);
    if (rpcError) { message(rpcError.message, true); return false; }
    await loadInventory();
    return true;
  }
  const createProduct = (name, quantity) => adminRpc('create_product', { p_name:name, p_quantity:quantity, p_id:crypto.randomUUID() });
  const renameProduct = (id, name) => adminRpc('rename_product', { p_product_id:id, p_name:name });
  const adjustStock = (id, delta, reason) => adminRpc('adjust_stock', { p_product_id:id, p_delta:delta, p_reason:reason });
  const setPrice = (id, cents) => adminRpc('set_price', { p_product_id:id, p_price_cents:cents });
  const setCost = (id, cents) => adminRpc('set_cost', { p_product_id:id, p_cost_cents:cents });
  const deleteProduct = id => adminRpc('delete_product', { p_product_id:id });
  async function loadCosts() {
    if (!cloudMode() || profile.role !== 'admin') return {};
    const { data, error: costError } = await client.from('product_costs').select('product_id,cost_cents');
    if (costError) { message(costError.message, true); return {}; }
    return Object.fromEntries((data || []).map(row => [row.product_id, row.cost_cents]));
  }
  async function loadProfitLines(fromISO) {
    if (!cloudMode() || profile.role !== 'admin') return [];
    const { data, error: profitError } = await client.rpc('profit_lines', { p_from:fromISO });
    if (profitError) { message(profitError.message, true); return null; }
    return (data || []).map(row => ({ sale:row.sale_id, at:row.sold_at, name:row.product_name, quantity:row.quantity, unit:row.unit_price_cents, cost:row.unit_cost_cents }));
  }
  async function checkout(lines, payment, requestId) {
    if (!cloudMode()) return { ok:false, definitive:true };
    const { data, error: rpcError } = await client.rpc('checkout_sale', { p_items:lines.map(line => ({ product_id:line.id, quantity:line.quantity })), p_payment:payment, p_request_id:requestId });
    if (rpcError) { message(rpcError.message, true); return { ok:false, definitive:Boolean(rpcError.code) }; }
    await loadInventory();
    return { ok:true, id:data };
  }
  async function issueInvoice(saleId, name, nif) {
    if (!cloudMode()) return null;
    const { data, error: rpcError } = await client.rpc('issue_invoice', { p_sale_id:saleId, p_customer_name:name, p_customer_nif:nif || null });
    if (rpcError) { message(rpcError.message, true); return null; }
    return Array.isArray(data) ? data[0] : data;
  }
  async function importLocal(items) {
    if (!cloudMode() || profile.role !== 'admin') return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const item of items) {
      const name = String(item.name || '').trim().slice(0, 80);
      const quantity = Math.floor(Number(item.quantity));
      if (!name || !Number.isFinite(quantity) || quantity < 0 || quantity > 1000000) continue;
      const { error: rpcError } = await client.rpc('create_product', { p_name:name, p_quantity:quantity, p_id:uuid.test(item.id) ? item.id : crypto.randomUUID() });
      if (rpcError) { message(rpcError.message, true); break; }
    }
    await loadInventory();
  }
  function clearLocalCache() {
    window.StockApp?.clearProducts();
    try { localStorage.removeItem('stock-loja-sales-v1'); } catch {}
  }
  function exportTeamCsv() {
    const quote = value => { let text = String(value ?? ''); if (/^[\s=+\-@]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };
    const rows = [['Nome','E-mail','Perfil','Acesso','Criada em'], ...teamUsers.map(user => [user.display_name,user.email,user.role,user.approved ? 'Aprovado' : 'Pendente',user.created_at])];
    const csv = '\ufeff' + rows.map(row => row.map(quote).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'equipa-stock.csv'; link.click(); URL.revokeObjectURL(url);
  }

  accountButton.addEventListener('click', async () => { show(); if (client && profile?.role === 'admin') await loadUsers(); });
  document.querySelector('#closeAccount').addEventListener('click', () => dialog.close());
  previewButton.addEventListener('click', () => { previewMode = true; updateUI(); });
  document.querySelector('#previewBack').addEventListener('click', () => { previewMode = false; updateUI(); });
  document.querySelector('#toggleAuthMode').addEventListener('click', () => { signupMode = !signupMode; error.hidden = true; updateUI(); });
  document.querySelector('#teamSearch').addEventListener('input', renderUsers);
  document.querySelector('#exportUsers').addEventListener('click', exportTeamCsv);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    error.hidden = true;
    const email = emailInput.value.trim();
    const result = signupMode
      ? await client.auth.signUp({ email, password:passwordInput.value, options: { data: { full_name:nameInput.value.trim() } } })
      : await client.auth.signInWithPassword({ email, password:passwordInput.value });
    if (result.error) { message(result.error.message, true); return; }
    if (signupMode && !result.data.session) message('Conta criada. Confirme o e-mail e aguarde aprovação do administrador.');
    else if (result.data.session) await refreshSession(result.data.session);
  });
  document.querySelector('#emailLinkButton').addEventListener('click', async () => {
    if (!emailInput.reportValidity()) return;
    const { error: otpError } = await client.auth.signInWithOtp({ email:emailInput.value.trim(), options:{ shouldCreateUser:true, emailRedirectTo:callbackUrl() } });
    if (otpError) message(otpError.message, true);
    else message('Enviámos um link de acesso para o seu e-mail. Abra-o neste dispositivo para entrar.');
  });
  document.querySelectorAll('.oauth-button').forEach(button => button.addEventListener('click', async () => {
    const { error: oauthError } = await client.auth.signInWithOAuth({ provider:button.dataset.provider, options:{ redirectTo:callbackUrl() } });
    if (oauthError) message(oauthError.message, true);
  }));
  document.querySelector('#forgotPassword').addEventListener('click', async () => {
    if (!emailInput.reportValidity()) return;
    const { error: resetError } = await client.auth.resetPasswordForEmail(emailInput.value.trim(), { redirectTo:callbackUrl() });
    if (resetError) message(resetError.message, true);
    else message('Se o e-mail estiver registado, receberá um link para criar uma nova senha.');
  });
  document.querySelector('#passwordRecovery').addEventListener('submit', async event => {
    event.preventDefault();
    const newPassword = document.querySelector('#newPassword').value;
    if (newPassword !== document.querySelector('#confirmNewPassword').value) { showToast('As senhas não coincidem.', true); return; }
    const { error: updateError } = await client.auth.updateUser({ password:newPassword });
    if (updateError) { showToast(updateError.message, true); return; }
    recoveryMode = false; updateUI(); showToast('Senha atualizada com sucesso.');
  });
  document.querySelector('#signOutButton').addEventListener('click', async () => { await client?.auth.signOut(); await refreshSession(null); });
  userList.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const userRow = button.closest('[data-user]');
    const user = teamUsers.find(item => item.id === userRow?.dataset.user);
    if (!user || user.id === session?.user.id) return;
    if (button.dataset.action === 'send-reset') {
      const { error: resetError } = await client.auth.resetPasswordForEmail(user.email, { redirectTo:callbackUrl() });
      if (resetError) message(resetError.message, true); else showToast(`Link de recuperação enviado para ${user.email}.`);
      return;
    }
    const newRole = userRow.querySelector('select').value;
    const approved = button.dataset.action === 'toggle-access' ? !user.approved : user.approved;
    const { error: accessError } = await client.rpc('set_profile_access', { target_user_id:user.id, new_role:newRole, new_approved:approved });
    if (accessError) { message(accessError.message, true); return; }
    showToast(button.dataset.action === 'toggle-access' ? (approved ? 'Acesso aprovado.' : 'Acesso à conta bloqueado.') : 'Perfil atualizado.');
    await loadUsers();
  });

  window.StockAuth = { client, getRole:role, isCloudMode:cloudMode, sell, setPrice, setCost, loadCosts, loadProfitLines, checkout, issueInvoice, createProduct, renameProduct, adjustStock, deleteProduct };
  updateUI();
  client?.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_IN') showToast('Login bem-sucedido!');
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; show(); updateUI(); }
    setTimeout(() => refreshSession(nextSession), 0);
  });
  window.addEventListener('online', () => { if (cloudMode()) loadInventory(); });
  window.addEventListener('focus', () => { if (cloudMode()) refreshProfile(); });
})();
