# Correções da auditoria de segurança

| ID | Correção | Ficheiros |
|----|----------|-----------|
| A1 | `has_inventory_access()` = só contas aprovadas; bloquear força `role='user'`; admins bloqueados existentes passam a `user` | migração |
| A2 | Fim do sync total: escritas por linha via RPC (`create_product`, `rename_product`, `adjust_stock`, `delete_product`) com movimento registado; `created_by` já não é reescrito; FK dos movimentos passa a `on delete set null` + `product_name` (histórico preservado); realtime com debounce | migração, `auth.js`, `app.js` |
| M1 | CSV da equipa neutraliza células iniciadas por `= + - @` | `auth.js` |
| M2 | Senha mínima 10 no registo/recuperação; MFA fica documentado como passo opcional na migração (exige TOTP ativo nos admins) | `auth.js`, `index.html`, migração |
| M3 | Tabela `access_audit` + guarda do "último admin" em `set_profile_access` | migração |
| M4 | Em modo cloud o inventário não é gravado no `localStorage`; ao sair/bloquear restaura-se só o modo local | `app.js`, `auth.js` |
| M5 | Depende de configuração do projeto (ver abaixo) | — |
| B1 | `record_sale` idempotente (`p_request_id`), botões protegidos contra duplo clique | migração, `auth.js`, `app.js` |
| B2 | Aba Vendas em modo cloud lê os movimentos do servidor | `auth.js`, `app.js` |
| B3 | `JSON.parse` protegido e validado; valores escapados | `app.js` |
| B4 | CSP adicionada. **SRI pendente** (precisa de rede para gerar o hash; ver comentário no `index.html`) | `index.html` |
| B5 | `flowType: 'pkce'` | `auth.js` |
| B6 | Service worker: navegação rede-primeiro, restante stale-while-revalidate, cache `v9` | `service-worker.js` |
| B7/B8 | Limites (`display_name` ≤ 80, `quantity` ≤ 1 000 000) e trigger de `updated_at` | migração |

## Não verificado (sem Postgres/browser neste ambiente)
Só foi feito `node --check` nos JS. A migração SQL **não foi executada**; o fluxo no browser não foi testado.

## Configuração manual no painel Supabase (M5/M2)
Confirmação de e-mail ligada · Redirect URLs exatas (sem wildcard/localhost em produção) · CAPTCHA no signup · MFA TOTP para admins · leaked-password protection (se o plano permitir) · adicionar SRI ao SDK.

## Testes a correr em staging
1. Admin bloqueado: não lê `products`/`stock_movements` e `record_sale` falha.
2. Bloquear o último admin aprovado falha.
3. Utilizador normal: `rpc('adjust_stock')`, `create_product`, `delete_product` → 42501; `insert/update/delete` direto em `products` → negado.
4. Duas sessões: editar numa e vender na outra não repõe quantidades antigas nem apaga produtos.
5. Repetir `record_sale` com o mesmo `p_request_id` não deduz duas vezes.
6. Apagar produto mantém o histórico (`product_name`).
7. Sair da conta: o inventário cloud não fica no `localStorage`.
8. Nome `=HYPERLINK(...)` → CSV exportado com `'` à frente.

## Caixa e faturas (nova funcionalidade)
- `pos.js` + `pos.css`: aba **Caixa** (carrinho com vários artigos, preços, pagamento em dinheiro/cartão/transferência, **Cobrar**, **Emitir fatura** com nome e NIF do cliente, impressão).
- `supabase/migrations/003_pos_invoices.sql` (aplicar depois da 002): `products.price_cents`, tabelas `sales`, `sale_items`, `invoices`, `invoice_counter` (numeração sequencial), RPC `set_price`, `checkout_sale` (atómica e idempotente) e `issue_invoice`.
- Modo local: preços em `localStorage` (`stock-loja-prices-v1`) e numeração local; em modo cloud tudo passa pelas RPC.
- **Aviso fiscal:** o documento é gerado pelo app e não substitui uma fatura certificada. Confirmar os requisitos de São Tomé e Príncipe com um contabilista.
- Não testado em browser nem em Postgres (só `node --check`).

## Navegação por abas (uma tela por função)
- `tabs.js` + `tabs.css`: barra de abas **Início · Inventário · Caixa · Vendas · Equipa\* · Movimentos\* · Conta** (\*só administradores). Cada função é uma tela própria, com URL `#inicio`, `#inventario`, `#caixa`, `#vendas`, `#equipa`, `#movimentos`, `#conta`. Em telemóvel a barra fica fixa em baixo.
- O antigo diálogo da conta foi desdobrado: login/perfil → **Conta**, gestão da equipa → **Equipa**, últimos movimentos → **Movimentos** (os nós são movidos, mantendo IDs e eventos).
- O botão "Entrar/Minha conta" do cabeçalho abre a aba Conta. Cache do service worker: `v11`.
- Não testado em browser (só `node --check`).

## Botões e Caixa + Vendas
- Botões de ação (−, +, editar, eliminar, tema, adicionar) usam ícones **SVG** em vez de símbolos Unicode (✎ ⌫ ＋ ☾ …), que apareciam vazios em dispositivos sem essas fontes. O avatar do produto passa a mostrar a inicial do nome.
- **Vendas** foi unida à **Caixa**: uma só aba com carrinho/cobrança/fatura e, por baixo, métricas e histórico de vendas. `#vendas` continua a abrir a Caixa. O formulário antigo de venda de um só produto ficou oculto (o carrinho substitui-o).
- Não testado em browser (só `node --check`).

## Tema escuro e Caixa legíveis
- `tabs.css` ganhou um bloco `body.dark-mode` completo (variáveis `--ink/--muted/--paper`, diálogos, títulos, texto secundário, campos, botões, abas, **Caixa/carrinho**, fatura) e cores explícitas no tema claro. `color-scheme: dark` para os controlos nativos. A fatura imprime sempre em preto sobre branco.
- Não testado em browser.

## Preço/custo por unidade e lucro
- **Caixa → "Preço por unidade":** por produto, custo e preço de venda por unidade (e margem). Em modo cloud só administradores veem/alteram custos.
- **Nova aba Lucro** (`profit.js`): lucro de **hoje, da semana (seg–dom) e do mês**, com receita, custo, margem, nº de vendas e unidades; detalhe por dia (14), semana (8) ou mês (6). Avisa quando há vendas sem custo definido. Função pública `StockProfit.summarize/breakdown`; testada com um caso manual.
- Modo local: vendas da Caixa gravam um registo (`stock-loja-ledger-v1`, até 5000 linhas) com preço e custo no momento da venda.
- `supabase/migrations/004_costs_profit.sql` (depois da 003): `product_costs` e `sale_item_costs` (só admins leem), RPC `set_cost`, `checkout_sale` com custo no momento da venda e `profit_lines(p_from)` (só admins). Os custos nunca ficam visíveis a utilizadores normais.
- Não testado em browser nem em Postgres; só a lógica de agregação foi testada em Node.

## Assistente de IA
- `assistant.js` + `assistant.css`: painel de conversa com sugestões; no modo cloud chama a Edge Function `assistant` e não executa ações no inventário.
- Contexto enviado: aba atual, modo/perfil e nomes/quantidades dos produtos. Não envia custos, lucro, e-mails, clientes ou senhas; a conversa permanece em memória.
- Aplicar `supabase/migrations/005_assistant_quota.sql` depois das migrações 002–004 e publicar com `supabase functions deploy assistant`.
- Configurar nos Secrets do Supabase `ANTHROPIC_API_KEY` e `ASSISTANT_ALLOWED_ORIGINS` com as origens exatas da PWA, separadas por vírgula. Opcionalmente configurar `ASSISTANT_MODEL` e `ASSISTANT_DAILY_LIMIT` (padrão 60).
- O frontend foi testado no browser; a Edge Function e as migrações remotas ainda não foram publicadas/verificadas.
