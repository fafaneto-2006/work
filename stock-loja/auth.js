(() => {
  const config = window.STOCK_SUPABASE_CONFIG;
  const sdk = window.supabase;
  const client = config && sdk?.createClient ? sdk.createClient(config.url, config.publishableKey) : null;
  const dialog = document.querySelector('#accountDialog');
  const form = document.querySelector('#authForm');
  const error = document.querySelector('#authError');
  const status = document.querySelector('#accountStatus');
  const accountButton = document.querySelector('#accountButton');
  const nameInput = document.querySelector('#authName');
  const nameLabel = document.querySelector('#nameLabel');
  const emailInput = document.querySelector('#authEmail');
  const passwordInput = document.querySelector('#authPassword');
  const adminUsers = document.querySelector('#adminUsers');
  const userList = document.querySelector('#userList');
  let session = null;
  let profile = null;
  let signupMode = false;

  function message(text = '', isError = false) {
    error.hidden = !text || !isError;
    error.textContent = isError ? text : '';
    if (text && !isError) status.textContent = text;
  }
  function role() { return profile?.approved ? profile.role : 'pending'; }
  function cloudMode() { return Boolean(client && session && profile?.approved); }
  function show() { dialog.showModal(); }
  function updateUI() {
    const signedIn = Boolean(session);
    accountButton.textContent = signedIn ? (profile?.role === 'admin' ? 'Admin' : 'Minha conta') : 'Entrar';
    document.querySelector('#accountTitle').textContent = signedIn ? (profile?.role === 'admin' ? 'Painel do administrador' : 'Conta de utilizador') : (signupMode ? 'Criar conta' : 'Entrar na loja');
    form.hidden = signedIn || !client;
    nameInput.hidden = !signupMode || signedIn || !client;
    nameLabel.hidden = nameInput.hidden;
    document.querySelector('#toggleAuthMode').hidden = signedIn || !client;
    document.querySelector('#toggleAuthMode').textContent = signupMode ? 'Já tenho conta' : 'Criar conta';
    document.querySelector('#authSubmit').textContent = signupMode ? 'Criar conta' : 'Entrar';
    document.querySelector('#signOutButton').hidden = !signedIn;
    adminUsers.hidden = !(signedIn && profile?.role === 'admin' && profile?.approved);
    if (!client) status.textContent = 'Login precisa de internet. O inventário local continua disponível offline.';
    else if (!signedIn) status.textContent = 'Entre para sincronizar o inventário. Pode continuar a usar o app localmente sem conta.';
    else if (!profile) status.textContent = 'A carregar o seu perfil…';
    else if (!profile.approved) status.textContent = 'Conta criada. Aguarde aprovação do administrador para aceder ao inventário partilhado.';
    else if (profile.role === 'admin') status.textContent = 'Administrador ativo: gere produtos e aprove contas da equipa.';
    else status.textContent = 'Utilizador ativo: consulte o stock e registe produtos vendidos.';
    document.querySelector('#addButton').hidden = cloudMode() && role() !== 'admin';
    document.querySelector('#emptyAddButton').hidden = cloudMode() && role() !== 'admin';
    if (window.StockApp) window.StockApp.setCloudRole(cloudMode() ? profile.role : null);
  }

  async function loadInventory() {
    if (!cloudMode()) return;
    const { data, error: queryError } = await client.from('products').select('id,name,quantity,created_at,updated_at').order('created_at', { ascending: false });
    if (queryError) { message(queryError.message, true); return; }
    if ((!data || data.length === 0) && profile.role === 'admin') {
      const localItems = window.StockApp?.getProducts() || [];
      if (localItems.length) { await syncProducts(localItems); return; }
    }
    window.StockApp?.replaceProducts((data || []).map(p => ({ id:p.id, name:p.name, quantity:p.quantity, createdAt:Date.parse(p.created_at) || Date.now(), updatedAt:Date.parse(p.updated_at) || Date.now() })));
  }

  async function loadUsers() {
    if (!adminUsers.hidden) {
      const { data, error: queryError } = await client.from('profiles').select('id,email,display_name,role,approved,created_at').order('created_at');
      if (queryError) { userList.textContent = queryError.message; return; }
      userList.innerHTML = (data || []).map(user => `<article class="team-user" data-user="${user.id}"><div><strong>${escapeHTML(user.display_name || user.email)}</strong><small>${escapeHTML(user.email)} · ${user.approved ? escapeHTML(user.role) : 'Pendente'}</small></div><div class="team-actions"><select aria-label="Perfil de ${escapeHTML(user.email)}"><option value="user" ${user.role === 'user' ? 'selected' : ''}>Utilizador</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select><button class="secondary-button" data-access="${user.approved ? 'revoke' : 'approve'}">${user.approved ? 'Bloquear' : 'Aprovar'}</button></div></article>`).join('') || '<p class="dialog-copy">Ainda não há contas registadas.</p>';
    }
  }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function refreshSession(nextSession) {
    session = nextSession;
    profile = null;
    if (session && client) {
      const { data } = await client.from('profiles').select('id,email,display_name,role,approved').eq('id', session.user.id).maybeSingle();
      profile = data || null;
    }
    updateUI();
    if (cloudMode()) { await loadInventory(); await loadUsers(); }
  }

  async function sell(productId, quantity = 1) {
    if (!cloudMode()) return false;
    const { error: rpcError } = await client.rpc('record_sale', { p_product_id: productId, p_quantity: quantity });
    if (rpcError) { message(rpcError.message, true); return false; }
    await loadInventory();
    return true;
  }

  async function syncProducts(items) {
    if (!cloudMode() || profile.role !== 'admin') return;
    const normalized = items.map(p => ({ ...p, id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.id) ? p.id : crypto.randomUUID() }));
    if (normalized.some((p, i) => p.id !== items[i].id)) window.StockApp?.replaceProducts(normalized);
    const { data: current, error: fetchError } = await client.from('products').select('id');
    if (fetchError) { message(fetchError.message, true); return; }
    const wanted = new Set(normalized.map(p => p.id));
    const remove = (current || []).filter(p => !wanted.has(p.id)).map(p => p.id);
    if (remove.length) {
      const { error: deleteError } = await client.from('products').delete().in('id', remove);
      if (deleteError) { message(deleteError.message, true); return; }
    }
    if (normalized.length) {
      const rows = normalized.map(p => ({ id:p.id, name:p.name, quantity:p.quantity, created_by:session.user.id }));
      const { error: upsertError } = await client.from('products').upsert(rows);
      if (upsertError) { message(upsertError.message, true); return; }
    }
    await loadInventory();
  }

  accountButton.addEventListener('click', async () => { show(); if (client && profile?.role === 'admin') await loadUsers(); });
  document.querySelector('#closeAccount').addEventListener('click', () => dialog.close());
  document.querySelector('#toggleAuthMode').addEventListener('click', () => { signupMode = !signupMode; error.hidden = true; updateUI(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    error.hidden = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const result = signupMode
      ? await client.auth.signUp({ email, password, options: { data: { full_name: nameInput.value.trim() } } })
      : await client.auth.signInWithPassword({ email, password });
    if (result.error) { message(result.error.message, true); return; }
    if (signupMode && !result.data.session) message('Conta criada. Confirme o e-mail e aguarde o administrador aprovar o acesso.');
    else { await refreshSession(result.data.session); }
  });
  document.querySelector('#signOutButton').addEventListener('click', async () => { await client?.auth.signOut(); await refreshSession(null); });
  userList.addEventListener('click', async event => {
    const button = event.target.closest('[data-access]');
    if (!button) return;
    const userId = button.closest('[data-user]').dataset.user;
    const roleSelect = button.parentElement.querySelector('select');
    const approve = button.dataset.access === 'approve';
    const { error: accessError } = await client.rpc('set_profile_access', { target_user_id:userId, new_role:roleSelect.value, new_approved:approve });
    if (accessError) { message(accessError.message, true); return; }
    await loadUsers();
  });

  window.StockAuth = { client, getRole: role, isCloudMode: cloudMode, sell, syncProducts };
  updateUI();
  if (client) client.auth.getSession().then(({ data }) => refreshSession(data.session)).catch(() => {});
  client?.auth.onAuthStateChange((_event, nextSession) => { setTimeout(() => refreshSession(nextSession), 0); });
  window.addEventListener('online', () => { if (cloudMode()) loadInventory(); });
})();
