# Stock — gestão de produtos e stock

App web instalável para telemóvel, em português, que ajuda uma loja a manter o inventário atualizado mesmo quando está sem internet.

## O que já está incluído

- Cadastro de produtos com qualquer nome e quantidade inicial.
- Edição do nome e da quantidade, além de ajustes rápidos de entrada e saída.
- Botão **Vendido** em cada produto para registar uma unidade vendida ou retirada do stock.
- Instalação como app no ecrã inicial do iPhone/iPad e do Android, com ícones próprios para cada plataforma.
- Resumo de unidades totais, produtos cadastrados e itens a repor (5 ou menos).
- Estados de stock disponível, baixo e esgotado.
- Pesquisa, ordenação e cópia de segurança em JSON.
- Interface adaptada a ecrãs pequenos e cache de ficheiros para uso offline.

## Como abrir

Sirva esta pasta por HTTPS ou por um servidor local. Abra a página no navegador do telemóvel e use a opção **Adicionar ao ecrã inicial** / **Instalar app**. Depois da primeira visita online, a interface fica disponível offline. Os produtos são guardados localmente no navegador desse dispositivo.

### Executar pelo VS Code

1. Abra esta pasta no VS Code.
2. Escolha **Terminal → Run Task…** (ou **Executar Tarefa…**) e selecione **Rodar Stock no navegador**.
3. No navegador, aceda a `http://localhost:8000`.

Também pode iniciar manualmente pelo terminal integrado: `python3 -m http.server 8000 --bind 127.0.0.1`, a partir desta pasta. Não abra `index.html` diretamente como ficheiro (`file://`): o navegador precisa do servidor local para ativar o service worker e o modo offline.

## Instalar no telemóvel

- **iPhone/iPad:** publique o app num endereço HTTPS, abra-o no Safari, toque em **Partilhar** → **Adicionar ao ecrã principal**, deixe **Abrir como app web** ativo e confirme em **Adicionar**.
- **Android:** publique o app num endereço HTTPS, abra-o no Chrome e toque em **Instalar app**; se a opção não aparecer, abra o menu ⋮ e escolha **Instalar app** ou **Adicionar ao ecrã inicial**.

O app é uma PWA: instala-se pelo navegador nos dois sistemas e guarda os dados localmente no dispositivo. Não é um pacote publicado na App Store ou Google Play.

## Ficheiros

- `index.html`, `styles.css`, `sold-button.css`, `platform-install.css`, `app.js`: interface e gestão do inventário.
- `manifest.webmanifest`, `service-worker.js`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: instalação e cache offline em iOS e Android.

## Limites atuais

Os dados não são sincronizados entre telemóveis ou computadores. Use a cópia de segurança para guardar uma exportação do inventário.
