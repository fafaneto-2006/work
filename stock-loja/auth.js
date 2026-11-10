(() => {
  const config = window.STOCK_SUPABASE_CONFIG;
  const sdk = window.supabase;
  const client = config && sdk?.createClient ? sdk.createClient(config.url, config.publishableKey) : null;
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
  function show() { dialog.showModal(); }
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
    const { data, error: activityError } = await client.from('stock_movements').select('id,movement_type,quantity_delta,quantity_before,quantity_after,created_at,products(name),profiles!stock_movements_user_id_fkey(display_name,email)').order('created_at', { ascending:false }).limit(12);
    if (activityError) { activityList.innerHTML = `<p class="dialog-copy">${escapeHTML(activityError.message)}</p>`; return; }
    activityList.innerHTML = (data || []).map(movement => `<article class="activity-row"><span class="activity-sign ${movement.quantity_delta < 0 ? 'is-out' : ''}">${movement.quantity_delta < 0 ? '−' : '+'}</span><div><strong>${escapeHTML(movement.products?.name || 'Produto removido')}</strong><small>${escapeHTML(movement.profiles?.display_name || movement.profiles?.email || 'Equipa')} · ${new Date(movement.created_at).toLocaleString('pt')}</small></div><b>${Math.abs(movement.quantity_delta)} un.</b></article>`).join('') || '<p class="dialog-copy">Ainda não há movimentos registados.</p>';
  }
  function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function refreshSession(nextSession) {
    if (inventoryChannel) { client.removeChannel(inventoryChannel); inventoryChannel = null; }
    session = nextSession;
    profile = null;
    if (session && client) {
      const { data } = await client.from('profiles').select('id,email,display_name,role,approved').eq('id', session.user.id).maybeSingle();
      profile = data || null;
    }
    updateUI();
    if (cloudMode()) {
      await loadInventory();
      await loadUsers();
      inventoryChannel = client.channel(`stock-products-${session.user.id}`).on('postgres_changes', { event:'*', schema:'public', table:'products' }, () => loadInventory()).subscribe();
    }
  }
  async function refreshProfile() {
    if (!session || !client) return;
    const { data } = await client.from('profiles').select('id,email,display_name,role,approved').eq('id', session.user.id).maybeSingle();
    profile = data || null;
    updateUI();
    if (cloudMode()) await loadInventory();
  }
  async function sell(productId, quantity = 1) {
    if (!cloudMode()) return false;
    const { error: rpcError } = await client.rpc('record_sale', { p_product_id: productId, p_quantity: quantity });
    if (rpcError) { message(rpcError.message, true); return false; }
    await loadInventory();
    return true;
  }
  async function loadSales() {
    if (!cloudMode()) return null;
    const { data, error: queryError } = await client.from('stock_movements').select('id,quantity_delta,created_at,products(name)').eq('movement_type','sale').order('created_at',{ascending:false}).limit(20);
    if (queryError) { message(queryError.message,true); return null; }
    return (data || []).map(row => ({ id:row.id, name:row.products?.name || 'Produto removido', quantity:Math.abs(row.quantity_delta), at:row.created_at }));
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
  function exportTeamCsv() {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
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

  window.StockAuth = { client, getRole:role, isCloudMode:cloudMode, sell, syncProducts, loadSales };
  updateUI();
  if (client) client.auth.getSession().then(({ data }) => refreshSession(data.session)).catch(() => {});
  client?.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_IN') showToast('Login bem-sucedido!');
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; show(); updateUI(); }
    setTimeout(() => refreshSession(nextSession), 0);
  });
  window.addEventListener('online', () => { if (cloudMode()) loadInventory(); });
  window.addEventListener('focus', () => { if (cloudMode()) refreshProfile(); });
})();
