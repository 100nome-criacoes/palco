# Arquitetura

O Palco é uma aplicação web estática, sem build, sem dependências instaláveis. jQuery e Font Awesome vêm de CDN. Tudo o resto é JavaScript simples carregado por `<script>` na ordem certa.

## Princípio central

O estado da sessão vive **num único sítio**: o objeto `Store`, que persiste em `localStorage`. Nenhum módulo guarda cópias próprias. Quando algo muda, o `Store` grava e notifica os subscritores (na mesma janela) e dispara o evento `storage` (na outra janela). Ambas as janelas desenham o estado que recebem.

## Módulos

### Identidade

- **`app-info.js`** — `APP_INFO`. Nome, versão, autor e `slug`. É o único sítio a editar para renomear a app. O `slug` prefixa as chaves do `localStorage` e os nomes de janela.

### Domínio

- **`utils.js`** — funções puras: `esc`, `uid`, `clamp`, `debounce`, `renderMarkdown`, `parseDuration`, `formatDuration`, `formatTime`, `youtubeId`, `youtubeEmbed`, `safeUrl`.
- **`scenes.js`** — lógica de grupos, cenas e temas. Não toca em DOM, storage nem notificações. Expõe `Scenes.PRESETS` (modelos de cena), `Scenes.THEMES` (temas de cor com contraste pré-calculado) e funções de leitura (`live`, `locate`, `theme`) e escrita sobre um *draft* (`setLive`, `step`, `toggleBreak`, `createGroup`, `update`, ...).

### Estado

- **`store.js`** — `Store`. A única fonte de verdade. Métodos relevantes:
  - `init()` — carrega do `localStorage`, normaliza e começa a ouvir a outra janela
  - `update(mutator)` — lê o estado mais recente, aplica a mutação, grava e notifica
  - `subscribe(cb)` — recebe avisos de mudança (locais e da outra janela)
  - `reload()` — relê o storage (útil antes de processar comandos)
  - `replace(state)` / `reset()` — substituir tudo (import/reset)
  - `normalize(input)` — valida e completa qualquer objeto vindo de fora
  - `parseImport(text)` — valida um JSON importado

### Comunicação

- **`sync.js`** — `Sync`. Transporta apenas o que é momentâneo:
  - comandos para o temporizador (`timer:start`, `timer:pause`, `timer:reset`, `timer:toggle`, `alarm:stop`)
  - heartbeat (a TV está aberta?)
  - estado publicado do temporizador (para o controlo ler em tempo real)
  - Cada comando vai por **dois canais** (`storage` e `BroadcastChannel`) para garantir entrega; o `id` do comando serve para deduplicar.
  - `openBoard()` não reabre a TV se já estiver ligada, porque reabrir reiniciaria o temporizador.

### Comportamentos partilhados

- **`actions.js`** — `Actions`. Operações de cena que tanto a TV como o controlo precisam (`goLive`, `stepScene`, `toggleBreak`). Escrevem no `Store` e deixam a outra janela reagir.
- **`timer.js`** — `Timer`. Motor do temporizador. Conta pelo **relógio** (`endsAt`) em vez de "-1 por tick", para não perder tempo se o browser atrasar os timers de uma janela em segundo plano.
- **`notify.js`** — `Notify` e `Alarm`. Toasts, aviso de 1 minuto e alarme de fim de tempo. O `Alarm` usa um único `AudioContext` (criar um por beep esgota o limite do browser) e desbloqueia-o no primeiro gesto do utilizador.

### Vistas

- **`board-view.js`** — `BoardView`. Desenha na TV: título, subtexto, cores do tema, qual temporizador está visível e onde, números e botões.
- **`media.js`** — `Media`. Desenha vídeos e site na TV. Idempotente: só substitui a `<iframe>` se o URL mudou, para não recarregar o vídeo a cada alteração de estado. Toca vídeos visíveis com repetição e pausa os escondidos, via `postMessage` (sem recarregar a iframe). A resolução é forçada pela altura-alvo do leitor (1080p em "1 vídeo", 720p em "2 vídeos").
- **`draggable.js`** — `Draggable`. Arrastar por uma pega, com rato e toque (usa *pointer events*).

### Arranques

- **`app-board.js`** — `AppBoard`. Arranca a TV: carrega o estado, inicializa `Timer` e `Media`, subscreve o `Store`, liga os botões locais e os atalhos (`P`, `G`, `F`, `Espaço`, setas), e processa comandos vindos do controlo. As **regras do temporizador** estão aqui (`onState`).
- **`app-control.js`** — `AppControl`. Arranca o painel: coluna esquerda (estado atual, temporizador remoto, cenas rápidas), coluna direita (editor de cenas, media, configuração do temporizador, sistema). O conceito de **`editingId`** é local a esta janela e distingue-se do `activeSceneId` do `Store`.

### Testes

- **`tests/logic.test.js`** — testes unitários em Node, sem dependências. Correr com `node tests/logic.test.js`.

## Convenções

- **Funções puras** sempre que possível. `Scenes` é o único módulo de lógica de domínio que não toca em DOM.
- **`state` para leitura, `draft` para escrita.** As funções `Scenes.*` que alteram recebem um *draft* mutável e são chamadas dentro de `Store.update()`.
- **Nada de estado duplicado.** Se precisares de um dado, lê do `Store`. Se precisares de o alterar, usa `Store.update()`.
- **A TV é "burra"** quanto aos dados: desenha o que recebe. As únicas regras de negócio na TV são as do temporizador.
- **O controlo não manda edições à TV:** grava no `Store`. Só ações momentâneas usam `Sync.send`.
- **Compatibilidade:** se um dia mudar o formato dos dados, incrementa `Store.VERSION` e trata a migração em `Store.normalize()`.
