/* =====================================================================
 * AppControl — arranque e lógica do painel de controlo (control.html)
 *
 * Duas ideias importantes:
 *
 *  1. "Em direto" ≠ "a editar".
 *     A cena em direto é Store.activeSceneId (o que está na TV).
 *     A cena a editar é `editingId`, local a esta janela. Editar uma cena
 *     NÃO mexe na TV (a menos que seja a que está em direto).
 *
 *  2. O controlo não tem cópia própria dos dados: escreve no Store e
 *     desenha o que lá está. Só os comandos do temporizador vão por Sync.
 * ===================================================================== */
const AppControl = {

    TIMER_MODE_LABELS: { big: 'Coluna', compact: 'Barra', hidden: 'Oculto' },
    LAYOUT_LABELS: { double: '2 vídeos', single: '1 vídeo', site: 'site', images: 'imagens' },

    /**
     * Campos de link (vídeos e site). Cada um tem 4 estados visíveis:
     * vazio, por guardar, guardado e inválido. Guardam ao colar, ao carregar em
     * Enter ou ao sair do campo (nunca a cada tecla, para não recarregar a TV).
     */
    LINKS: [
        { key: 'video1', input: '#video1Url', slot: 1, noun: 'Vídeo 1',
          parse: (raw) => (Utils.youtubeId(raw) ? raw.trim() : null),
          invalid: 'URL do YouTube inválido',
          get: (s) => s.videos[1].url,
          set: (d, url) => { d.videos[1].url = url; },
          clear: (d) => { d.videos[1].url = ''; } },
        { key: 'video2', input: '#video2Url', slot: 2, noun: 'Vídeo 2',
          parse: (raw) => (Utils.youtubeId(raw) ? raw.trim() : null),
          invalid: 'URL do YouTube inválido',
          get: (s) => s.videos[2].url,
          set: (d, url) => { d.videos[2].url = url; },
          clear: (d) => { d.videos[2].url = ''; } },
        { key: 'site', input: '#siteUrl', noun: 'Site',
          parse: (raw) => Utils.safeUrl(raw),
          invalid: 'URL inválido (tem de ser http ou https)',
          get: (s) => s.siteUrl,
          set: (d, url) => { d.siteUrl = url; d.layout = 'site'; },
          clear: (d) => { d.siteUrl = ''; if (d.layout === 'site') d.layout = 'double'; } }
    ],

    editingId: null,
    _dragId: null,

    init() {
        document.title = `${APP_INFO.name} · Controlo`;
        this.fillFooter();
        const state = Store.init();
        this.editingId = state.activeSceneId;

        this.buildSwatches();
        ControlPreview.init();
        Store.subscribe((s) => this.onState(s));
        this.bindUi();
        ControlGallery.init((type) => this.sendToBoard(type, {}));
        this.renderAll(state);

        setInterval(() => this.refreshLive(), 500);
        this.refreshLive();
    },

    /** Rodapé: tudo vem de APP_INFO (js/app-info.js). */
    fillFooter() {
        $('#footName').text(APP_INFO.name);
        $('#footVersion').text(APP_INFO.version);
        $('#footCodename').text(`"${APP_INFO.codename}"`);
        $('#footAuthor').text(`por ${APP_INFO.author}`);
        $('#footRepo').attr('href', APP_INFO.repo);
        $('#footIssues').attr('href', APP_INFO.issuesUrl);
        $('#footLicense').attr('href', APP_INFO.licenseUrl).text(`Licença ${APP_INFO.license}`);
    },

    /* ============================================================
     * Estado → ecrã
     * ============================================================ */
    onState(state) {
        // A cena que estava a ser editada pode ter desaparecido (import, reset, outra janela)
        if (!Scenes.locate(state, this.editingId)) this.editingId = state.activeSceneId;
        this.renderAll(state);
    },

    renderAll(state) {
        this.renderLeftColumn(state);
        ControlPreview.render(state);
        this.renderEditor(state);
        this.renderMedia(state);
        this.renderTimerSettings(state);
        ControlGallery.render(state);
        this.refreshLive();
    },

    /** Escreve num campo, exceto se o utilizador estiver a escrever nele. */
    setField($el, value) {
        if ($el[0] === document.activeElement) return;
        if ($el.is(':checkbox')) $el.prop('checked', !!value);
        else $el.val(value);
    },

    /* ---------- Coluna esquerda ---------- */
    renderLeftColumn(state) {
        const live = Scenes.live(state);
        const group = Scenes.group(state);

        $('#stateScene').text(`${live.emoji} ${live.name}`.trim());
        $('#quickGroupName').text(group.name);

        const $quick = $('#quickScenes').empty();
        group.scenes.forEach(s => {
            $('<button>')
                .addClass('quick-scene-btn')
                .toggleClass('active', s.id === live.id)
                .toggleClass('break-style', s.isBreak)
                .html(`<span class="emoji">${Utils.esc(s.emoji || '•')}</span><span>${Utils.esc(s.name)}</span>`)
                .on('click', () => this.goLive(s.id))
                .appendTo($quick);
        });
    },

    /* ---------- Paleta de cores (construída uma vez; depois só se marca a ativa) ---------- */
    buildSwatches() {
        const $box = $('#themeSwatches');
        Object.entries(Scenes.THEMES).forEach(([key, t]) => {
            $('<button type="button">')
                .addClass('swatch')
                .attr({ 'data-theme': key, title: t.label })
                .css({ background: t.bg, color: t.title })
                .text('Aa')
                .on('click', () => this.commit({ theme: key }))
                .appendTo($box);
        });
        $('<label class="swatch custom" title="Cor personalizada">' +
          '<i class="fas fa-eye-dropper"></i><input type="color" id="bgColorInput" value="#f2edb7"></label>')
            .appendTo($box);
        $box.on('change', '#bgColorInput', (e) => this.commit({ bg: e.target.value }));
    },

    renderSwatches(scene) {
        const activeKey = scene.bg ? null : Scenes.themeKey(scene);
        $('#themeSwatches .swatch[data-theme]').each(function () {
            $(this).toggleClass('active', $(this).data('theme') === activeKey);
        });
        const $custom = $('#themeSwatches .swatch.custom');
        $custom.toggleClass('active', !!scene.bg);
        $custom.css('background', scene.bg || '');
        this.setField($('#bgColorInput'), Scenes.theme(scene).bg);
    },

    /* ---------- Editor de cenas ---------- */
    renderEditor(state) {
        const hit = Scenes.locate(state, this.editingId);
        if (!hit) return;
        const { group, scene } = hit;

        // Grupos
        const $groups = $('#groupSelect').empty();
        state.groups.forEach(g => {
            $('<option>').val(g.id).text(g.name).prop('selected', g.id === group.id).appendTo($groups);
        });
        const gi = state.groups.findIndex(g => g.id === group.id);
        $('#deleteGroupBtn').prop('disabled', state.groups.length <= 1);
        $('#groupUpBtn').prop('disabled', gi <= 0);
        $('#groupDownBtn').prop('disabled', gi >= state.groups.length - 1);

        // Lista de cenas do grupo a editar
        this.renderSceneList(state, group, scene);
        const si = group.scenes.findIndex(s => s.id === scene.id);
        $('#sceneUpBtn').prop('disabled', si <= 0);
        $('#sceneDownBtn').prop('disabled', si >= group.scenes.length - 1);

        // Cabeçalho do editor
        const isLive = scene.id === state.activeSceneId;
        $('#editorTitle').text(`${scene.emoji} ${scene.name}`.trim());
        $('#editorLiveBadge').toggleClass('hidden', !isLive);
        $('#goLiveBtn').prop('disabled', isLive);

        // Campos
        this.setField($('#emojiInput'), scene.emoji);
        this.setField($('#nameInput'), scene.name);
        this.setField($('#sceneIsBreak'), scene.isBreak);
        this.markActive('#sceneTimerSegmented', 'scene-timer', scene.timerMode || 'inherit');
        $('#sceneTimerRow').toggleClass('hidden', scene.isBreak);      // em pausa o tempo é sempre grande
        this.setField($('#sceneDuration'), scene.duration ? Utils.formatDuration(scene.duration) : '');
        this.setField($('#textInput'), scene.text);
        this.setField($('#subtextInput'), scene.subtext);
        this.renderSwatches(scene);
    },

    renderSceneList(state, group, editing) {
        const $list = $('#sceneList').empty();
        group.scenes.forEach((s, index) => {
            const badge = s.isBreak ? ' <small class="muted-green">· pausa</small>' : '';
            const dot = s.id === state.activeSceneId ? '<span class="live-dot" title="Em direto na TV"></span>' : '';
            $('<div>')
                .addClass('scene-list-item')
                .toggleClass('active', s.id === editing.id)
                .attr({ draggable: 'true', 'data-id': s.id })
                .html(`<i class="fas fa-grip-vertical grip"></i><span class="emoji">${Utils.esc(s.emoji || '•')}</span>` +
                      `<span class="grow">${Utils.esc(s.name)}${badge}</span>${dot}`)
                .on('dragstart', (e) => {
                    this._dragId = s.id;
                    e.originalEvent.dataTransfer.effectAllowed = 'move';
                    e.originalEvent.dataTransfer.setData('text/plain', s.id);
                    $(e.currentTarget).addClass('dragging');
                })
                .on('dragend', (e) => {
                    this._dragId = null;
                    $(e.currentTarget).removeClass('dragging');
                    $('.scene-list-item').removeClass('drop-before drop-after');
                })
                .on('dragover', (e) => {
                    if (!this._dragId) return;
                    e.preventDefault();
                    const before = this.isUpperHalf(e);
                    $(e.currentTarget).toggleClass('drop-before', before).toggleClass('drop-after', !before);
                })
                .on('dragleave', (e) => $(e.currentTarget).removeClass('drop-before drop-after'))
                .on('drop', (e) => {
                    e.preventDefault();
                    if (!this._dragId) return;
                    const insertAt = index + (this.isUpperHalf(e) ? 0 : 1);
                    const id = this._dragId;
                    this._dragId = null;
                    Store.update(d => Scenes.moveScene(d, id, insertAt));
                })
                .appendTo($list);
        });
    },

    isUpperHalf(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        return e.originalEvent.clientY < rect.top + rect.height / 2;
    },

    /* ---------- Media ---------- */
    renderMedia(state) {
        this.markActive('#layoutSegmented', 'layout', state.layout);

        const scaleApplies = state.layout !== 'timer';
        $('#scaleSegmented').toggleClass('disabled', !scaleApplies)
            .toggleClass('no-fill', state.layout === 'images');     // nas imagens "Preencher" = "Cobrir"
        this.markActive('#scaleSegmented', 'scale', scaleApplies ? state.scales[state.layout] : null);
        const defaultScale = scaleApplies ? Store.DEFAULT_SCALES[state.layout] : null;
        $('#scaleSegmented button').each(function () {
            $(this).toggleClass('is-default', $(this).data('scale') === defaultScale);
        });
        $('#scaleModeLabel').text(scaleApplies ? `· modo ${this.LAYOUT_LABELS[state.layout]}` : '· não se aplica a "só tempo"');

        this.LINKS.forEach(link => this.renderLink(link, state));
        for (const slot of [1, 2]) {
            const video = state.videos[slot];
            const $btn = $(`[data-toggle-mute="${slot}"]`).toggleClass('muted', video.muted).prop('disabled', !video.url);
            $btn.find('i').attr('class', video.muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high');
            $btn.attr('title', video.muted ? `Vídeo ${slot} sem som (clica para ativar)` : `Vídeo ${slot} com som (clica para silenciar)`);
        }
        $('#swapVideosBtn').prop('disabled', !state.videos[1].url && !state.videos[2].url);
    },

    /** Campo "personalizado": o botão mostra o tempo lido e só ativa com valor válido e a TV ligada. */
    refreshCustom(connected) {
        const raw = $('#customMinutes').val().trim();
        const secs = Utils.parseDuration(raw);
        $('#customMinutes').toggleClass('is-invalid', !!raw && !secs);
        $('#customPreview').text(secs ? Utils.formatTime(secs) : '');
        $('#applyCustomBtn').prop('disabled', !secs || !connected);
    },

    /**
     * Botões de pausa dos vídeos. O ícone mostra sempre o estado real (a TV lembra-se da
     * pausa mesmo com o vídeo fora do ecrã) e dá para o preparar antes de o mostrar.
     */
    refreshVideoButtons(state, connected) {
        const shown = Scenes.mediaShown(state);
        const onScreen = {
            1: shown && (state.layout === 'double' || state.layout === 'single'),
            2: shown && state.layout === 'double'
        };
        const vs = Sync.getVideoState();
        for (const slot of [1, 2]) {
            const hasVideo = !!state.videos[slot].url;
            const paused = !!(vs && vs.paused && vs.paused[slot]);
            const title = !hasVideo ? `Vídeo ${slot}: sem vídeo`
                : `Vídeo ${slot} ${paused ? 'em pausa (clica para retomar)' : 'a tocar (clica para pausar)'}`
                  + (onScreen[slot] ? '' : '. Fora do ecrã agora');
            const $btn = $(`[data-toggle-play="${slot}"]`).prop('disabled', !connected || !hasVideo).attr('title', title);
            $btn.find('i').attr('class', paused ? 'fas fa-play' : 'fas fa-pause');
        }
        ControlPreview.setPaused(vs);
    },

    /* ---------- Campos de link: estado e feedback ---------- */
    linkElements(link) {
        const $input = $(link.input);
        const $row = $input.closest('.form-row');
        return { $input, $row, $status: $row.find('.link-status'), $msg: $row.find('[data-link-msg]'), $remove: $row.find('[data-link-remove]') };
    },

    /** Estado do campo: 'empty' | 'edit' (apagou o texto) | 'saved' | 'draft' | 'invalid' */
    linkState(link, raw, saved) {
        const text = raw.trim();
        if (!text) return saved ? 'edit' : 'empty';
        const parsed = link.parse(text);
        if (!parsed) return 'invalid';
        return parsed === saved ? 'saved' : 'draft';
    },

    renderLink(link, state) {
        const saved = link.get(state);
        const el = this.linkElements(link);
        if (el.$input[0] !== document.activeElement) el.$input.val(saved);
        this.paintLink(link, saved);
    },

    /** Só desenha o estado (cores, ícone, mensagem, botão de remover). Não grava. */
    paintLink(link, saved) {
        const el = this.linkElements(link);
        const st = this.linkState(link, el.$input.val(), saved);
        const icons = { saved: 'fa-circle-check', draft: 'fa-circle-dot', invalid: 'fa-circle-exclamation' };
        const msgs = {
            draft: 'Por guardar. Carrega em Enter ou sai do campo.',
            edit: 'Campo vazio. Usa o lixo para remover o link guardado.',
            invalid: saved ? `${link.invalid}. O link guardado mantém-se.` : link.invalid
        };

        el.$input.removeClass('is-saved is-draft is-invalid').toggleClass(`is-${st}`, ['saved', 'draft', 'invalid'].includes(st));
        el.$status.attr('class', `link-status ${st}`).html(icons[st] ? `<i class="fas ${icons[st]}"></i>` : '')
            .attr('title', st === 'saved' ? 'Guardado' : '');
        el.$msg.text(msgs[st] || '').toggleClass('bad', st === 'invalid').toggleClass('hidden', !msgs[st]);
        el.$remove.prop('disabled', !saved);
    },

    /** Guarda se for válido e diferente do guardado. Campo vazio volta ao guardado. */
    saveLink(link) {
        const state = Store.get();
        const saved = link.get(state);
        const el = this.linkElements(link);
        const text = el.$input.val().trim();

        if (!text) { el.$input.val(saved); return this.paintLink(link, saved); }
        const parsed = link.parse(text);
        if (!parsed) return this.paintLink(link, saved);          // fica vermelho, com a mensagem
        if (parsed === saved) return this.paintLink(link, saved);

        Store.update(d => link.set(d, parsed));
        Notify.show(`${link.noun} guardado`, 'SUCCESS');
    },

    removeLink(link) {
        Store.update(d => link.clear(d));
        this.linkElements(link).$input.val('');
        Notify.show(`${link.noun} removido`, 'INFO');
    },

    renderTimerSettings(state) {
        this.markActive('#timerDefaultSegmented', 'timer-mode', state.timerMode);
        this.markActive('#textSizeSegmented', 'text-size', state.textSize);
        this.setField($('#timerMinutes'), Utils.formatDuration(state.timerDuration));
        $('#timerMinutes').removeClass('is-invalid');
        $('#timerConfigMeta').text(`${Utils.formatDuration(state.timerDuration)} min · ${this.TIMER_MODE_LABELS[state.timerMode]}`);
    },

    markActive(selector, dataKey, value) {
        $(`${selector} button`).each(function () {
            $(this).toggleClass('active', $(this).data(dataKey) === value);
        });
    },

    /* ---------- Atualização periódica (ligação, temporizador e campainha da TV) ---------- */
    refreshLive() {
        const state = Store.get();
        if (!state) return;

        const connected = Sync.isBoardConnected();
        $('#connStatus').toggleClass('connected', connected)
            .find('.conn-label').text(connected ? 'Ligado à TV' : 'TV não detetada');

        const t = Sync.getTimerState();
        if (t) {
            ControlPreview.setTime(Utils.formatTime(t.remaining));
            $('#remoteTime').text(Utils.formatTime(t.remaining));
            $('#remoteStatus').text(t.running ? 'a contar' : 'parado').toggleClass('running', t.running);
            $('#stateTimer').text(Utils.formatTime(t.remaining) + (t.running ? ' ▶' : ' ⏸'));
        } else {
            ControlPreview.setTime(Utils.formatTime(Scenes.timerSeconds(state)));
            $('#remoteTime').text(Utils.formatTime(Scenes.timerSeconds(state)));
            $('#remoteStatus').text('desligado').removeClass('running');
            $('#stateTimer').text('-');
        }

        // Um só botão: "Iniciar" (verde) quando parado, "Pausar" (laranja) quando a contar
        const running = !!(t && t.running);
        $('#remoteToggle').prop('disabled', !t).toggleClass('success', !running).toggleClass('warn', running)
            .find('i').attr('class', running ? 'fas fa-pause' : 'fas fa-play')
            .end().find('span').text(running ? 'Pausar' : 'Iniciar');
        $('#remoteReset').prop('disabled', !t);
        $('.preset-btn').prop('disabled', !connected);
        this.refreshCustom(connected);
        ControlGallery.refreshTransport(state, connected);
        this.refreshVideoButtons(state, connected);

        // Campainha: acende enquanto o alarme toca na TV
        const ringing = !!(t && t.alarm);
        $('#alarmBtn').prop('disabled', !ringing).toggleClass('ringing', ringing);
    },

    /* ============================================================
     * Ações
     * ============================================================ */

    /** Abre uma cena no editor (não mexe na TV). */
    edit(sceneId) {
        this.editingId = sceneId;
        this.renderEditor(Store.get());
    },

    /** Põe uma cena na TV e passa a editá-la. */
    goLive(sceneId) {
        this.editingId = sceneId;
        Actions.goLive(sceneId);
        this.renderAll(Store.get());
    },

    /** Grava alterações na cena que está a ser editada. */
    commit(patch) {
        Store.update(d => Scenes.update(d, this.editingId, patch));
    },

    commitTexts() {
        this.commit({ text: $('#textInput').val(), subtext: $('#subtextInput').val() });
    },

    /** Envia um comando à TV, avisando se ela não estiver ligada. */
    sendToBoard(type, payload, message) {
        if (!Sync.isBoardConnected()) {
            return Notify.show('TV não detetada. Abre a TV primeiro', 'WARNING');
        }
        Sync.send(type, payload);
        if (message) Notify.show(message, 'SUCCESS');
    },

    startTimerWithSeconds(seconds) {
        this.sendToBoard('timer:start', { seconds }, `Temporizador: ${Utils.formatTime(seconds)}`);
    },

    /* ============================================================
     * Ligações (eventos)
     * ============================================================ */
    bindUi() {
        this.bindHeader();
        this.bindTimer();
        this.bindGroups();
        this.bindScenes();
        this.bindEditor();
        this.bindMedia();
        this.bindSystem();
        this.bindKeys();
    },

    bindHeader() {
        $('#openTvBtn').on('click', () => {
            const result = Sync.openBoard();
            if (result === 'already') Notify.show('A TV já está aberta', 'INFO');
            else if (result === 'blocked') Notify.show('Popup bloqueado. Abre index.html manualmente', 'WARNING');
            else setTimeout(() => this.refreshLive(), 600);
        });
    },

    bindTimer() {
        // Iniciar / Pausar: lê o estado real no momento do clique
        $('#remoteToggle').on('click', () => {
            const t = Sync.getTimerState();
            this.sendToBoard(t && t.running ? 'timer:pause' : 'timer:start', {});
        });
        $('#remoteReset').on('click', () => this.sendToBoard('timer:reset', {}));
        $('#alarmBtn').on('click', () => this.sendToBoard('alarm:stop', {}));

        $('.preset-btn').on('click', (e) => {
            this.startTimerWithSeconds(parseInt($(e.currentTarget).data('secs'), 10));
        });

        // Personalizado: "5", "5:30", "5:3"
        $('#customMinutes').on('input', () => this.refreshCustom(Sync.isBoardConnected()));
        $('#applyCustomBtn').on('click', () => {
            const secs = Utils.parseDuration($('#customMinutes').val());
            if (secs) this.startTimerWithSeconds(secs);
        });
        $('#customMinutes').on('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (Utils.parseDuration($('#customMinutes').val())) $('#applyCustomBtn').trigger('click');
            else Notify.show('Usa minutos (5) ou min:seg (5:30), até 180 min', 'WARNING');
        });

        // Tamanho do texto na TV (depende da sala, por isso é global)
        $('#textSizeSegmented').on('click', 'button', (e) => {
            const size = $(e.currentTarget).data('text-size');
            Store.update(d => { d.textSize = size; });
        });

        // Aparência padrão do tempo (as cenas podem ter a sua, no editor)
        $('#timerDefaultSegmented').on('click', 'button', (e) => {
            const mode = $(e.currentTarget).data('timer-mode');
            Store.update(d => { d.timerMode = mode; });
        });

        // Duração global: aceita logo se for válida (ao sair do campo ou Enter); se não, volta ao anterior
        const $duration = $('#timerMinutes');
        $duration.on('input', () => {
            const raw = $duration.val().trim();
            $duration.toggleClass('is-invalid', !!raw && !Utils.parseDuration(raw));
        });
        $duration.on('change', () => {
            const saved = Store.get().timerDuration;
            const secs = Utils.parseDuration($duration.val());
            if (!secs) {
                Notify.show('Usa minutos (15) ou min:seg (7:30), até 180 min', 'WARNING');
                $duration.val(Utils.formatDuration(saved)).removeClass('is-invalid');
                return;
            }
            $duration.val(Utils.formatDuration(secs)).removeClass('is-invalid');
            if (secs === saved) return;
            Store.update(d => { d.timerDuration = secs; });
            Notify.show(`Duração global: ${Utils.formatTime(secs)}`, 'SUCCESS');
        });
    },

    bindGroups() {
        const editingGroupId = () => Scenes.locate(Store.get(), this.editingId).group.id;

        $('#groupSelect').on('change', (e) => {
            const group = Store.get().groups.find(g => g.id === $(e.target).val());
            if (group) this.edit(group.scenes[0].id);
        });

        $('#newGroupBtn').on('click', () => {
            const name = (prompt('Nome do novo grupo:') || '').trim();
            if (!name) return;
            let created;
            Store.update(d => { created = Scenes.createGroup(d, name); });
            if (created) this.edit(created.scenes[0].id);
        });

        $('#renameGroupBtn').on('click', () => {
            const group = Scenes.locate(Store.get(), this.editingId).group;
            const name = (prompt('Novo nome do grupo:', group.name) || '').trim();
            if (!name || name === group.name) return;
            Store.update(d => Scenes.renameGroup(d, group.id, name));
            Notify.show('Grupo renomeado', 'SUCCESS');
        });

        $('#duplicateGroupBtn').on('click', () => {
            const hit = Scenes.locate(Store.get(), this.editingId);
            const index = hit.group.scenes.findIndex(s => s.id === hit.scene.id);
            let copy;
            Store.update(d => { copy = Scenes.duplicateGroup(d, hit.group.id); });
            if (!copy) return;
            this.edit(copy.scenes[index].id);     // abre a cópia na mesma cena que estavas a ver
            Notify.show(`Grupo duplicado: ${copy.name}`, 'SUCCESS');
        });

        $('#deleteGroupBtn').on('click', () => {
            const state = Store.get();
            const group = Scenes.locate(state, this.editingId).group;
            if (state.groups.length <= 1) return Notify.show('Tem de existir pelo menos 1 grupo', 'WARNING');

            const n = group.scenes.length;
            let msg = `Apagar o grupo "${group.name}" e as suas ${n} cena${n === 1 ? '' : 's'}?`;
            if (group.id === state.activeGroupId) msg += '\n\nEste grupo está em direto: a TV passa para outro grupo.';
            if (!confirm(msg)) return;

            let next;
            Store.update(d => { next = Scenes.deleteGroup(d, group.id); });
            if (!next) return;
            const target = Store.get().groups.find(g => g.id === next);
            this.edit(target.scenes[0].id);
            Notify.show('Grupo apagado', 'INFO');
        });

        $('#groupUpBtn').on('click', () => Store.update(d => Scenes.moveGroup(d, editingGroupId(), -1)));
        $('#groupDownBtn').on('click', () => Store.update(d => Scenes.moveGroup(d, editingGroupId(), 1)));
    },

    bindScenes() {
        // Clique edita; duplo clique põe a cena na TV. Deteta-se pelo tempo entre cliques (e não por
        // "dblclick") porque a lista é redesenhada ao primeiro clique.
        $('#sceneList').on('click', '.scene-list-item', (e) => {
            const id = $(e.currentTarget).attr('data-id');
            const now = Date.now();
            const last = this._lastListClick;
            this._lastListClick = { id, at: now };
            if (last && last.id === id && now - last.at < 400) {
                this._lastListClick = null;
                this.goLive(id);
            } else {
                this.edit(id);
            }
        });

        $('#newSceneBtn').on('click', () => {
            const hit = Scenes.locate(Store.get(), this.editingId);
            let created;
            Store.update(d => { created = Scenes.createScene(d, hit.group.id); });
            if (!created) return;
            this.edit(created.id);
            $('#nameInput').trigger('focus').trigger('select');   // pronto a dar nome
        });

        $('#sceneUpBtn').on('click', () => Store.update(d => Scenes.nudgeScene(d, this.editingId, -1)));
        $('#sceneDownBtn').on('click', () => Store.update(d => Scenes.nudgeScene(d, this.editingId, 1)));

        $('#deleteSceneBtn').on('click', () => {
            const hit = Scenes.locate(Store.get(), this.editingId);
            if (!hit) return;
            if (hit.group.scenes.length <= 1) return Notify.show('Cada grupo precisa de pelo menos 1 cena', 'WARNING');
            if (!confirm(`Apagar a cena "${hit.scene.name}"?`)) return;

            let next;
            Store.update(d => { next = Scenes.deleteScene(d, hit.scene.id); });
            if (next) this.edit(next);
        });

        $('#goLiveBtn').on('click', () => this.goLive(this.editingId));
    },

    bindEditor() {
        // Gravam na cena ao confirmar (change = ao sair do campo)
        $('#nameInput').on('change', (e) => this.commit({ name: e.target.value }));
        $('#emojiInput').on('change', (e) => this.commit({ emoji: e.target.value }));
        $('#sceneIsBreak').on('change', (e) => this.commit({ isBreak: e.target.checked }));
        $('#sceneTimerSegmented').on('click', 'button', (e) => {
            const value = $(e.currentTarget).data('scene-timer');
            this.commit({ timerMode: value === 'inherit' ? null : value });
        });

        $('#resetColorBtn').on('click', () => {
            this.commit({ theme: null, bg: null });
            Notify.show('Cor padrão reposta', 'SUCCESS');
        });

        // Duração da cena (qualquer cena): "", "10", "10:30"
        $('#sceneDuration').on('change', (e) => {
            const raw = e.target.value.trim();
            if (!raw) return this.commit({ duration: 0 });
            const secs = Utils.parseDuration(raw);
            if (!secs) {
                Notify.show('Usa minutos (10) ou min:seg (10:30)', 'WARNING');
                return this.renderEditor(Store.get());
            }
            this.commit({ duration: secs });
        });
        $('#sceneDurationClearBtn').on('click', () => {
            $('#sceneDuration').val('');
            this.commit({ duration: 0 });
            Notify.show('A usar duração global', 'INFO');
        });

        // Textos: guardam enquanto se escreve (com pequena espera) e ao sair do campo
        const saveTexts = Utils.debounce(() => this.commitTexts(), 400);
        $('#textInput, #subtextInput').on('input', saveTexts).on('change', () => this.commitTexts());

        $('#restoreTextBtn').on('click', () => {
            let restored = false;
            Store.update(d => { restored = Scenes.restoreDefaultText(d, this.editingId); return restored; });
            if (restored) Notify.show('Texto original restaurado', 'SUCCESS');
            else Notify.show('Esta cena não tem texto original (só as cenas de origem têm)', 'WARNING');
        });
    },

    bindMedia() {
        $('#layoutSegmented').on('click', 'button', (e) => {
            const layout = $(e.currentTarget).data('layout');
            Store.update(d => { d.layout = layout; });
        });
        // A escala é guardada por modo (2 vídeos / 1 vídeo / site / imagens)
        $('#scaleSegmented').on('click', 'button', (e) => {
            const scale = $(e.currentTarget).data('scale');
            Store.update(d => { if (d.scales[d.layout] !== undefined) d.scales[d.layout] = scale; });
        });

        this.LINKS.forEach(link => {
            const el = this.linkElements(link);
            // Enquanto escreve só atualiza o estado visual; guardar é ao colar / Enter / sair
            el.$input.on('input', () => this.paintLink(link, link.get(Store.get())));
            el.$input.on('paste', () => setTimeout(() => this.saveLink(link), 0));
            el.$input.on('change', () => this.saveLink(link));
            el.$remove.on('click', () => this.removeLink(link));
        });

        for (const slot of [1, 2]) {
            $(`[data-toggle-mute="${slot}"]`).on('click', () => {
                Store.update(d => { d.videos[slot].muted = !d.videos[slot].muted; });
            });
            $(`[data-toggle-play="${slot}"]`).on('click', () => this.sendToBoard('video:toggle', { slot }));
        }

        // Troca os vídeos inteiros (URL + som), por isso o mute acompanha cada vídeo
        $('#swapVideosBtn').on('click', () => {
            Store.update(d => { [d.videos[1], d.videos[2]] = [d.videos[2], d.videos[1]]; });
            Notify.show('Vídeos trocados', 'SUCCESS');
        });
    },

    bindSystem() {
        $('#exportBtn').on('click', () => this.exportConfig());
        $('#importBtn').on('click', () => $('#importFile').trigger('click'));
        $('#importFile').on('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => this.importConfig(ev.target.result);
            reader.readAsText(file);
            $(e.target).val('');
        });
        $('#resetAllBtn').on('click', () => this.resetAll());
    },

    bindKeys() {
        $(document).on('keydown', (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (tag === 'BUTTON') document.activeElement.blur();

            if (e.key === 'ArrowRight')            { e.preventDefault(); Actions.stepScene(1); }
            else if (e.key === 'ArrowLeft')        { e.preventDefault(); Actions.stepScene(-1); }
            else if (e.key.toLowerCase() === 'p')  { e.preventDefault(); Actions.toggleBreak(); }
            else if (e.code === 'Space')           { e.preventDefault(); Sync.send('timer:toggle'); }
        });
    },

    /* ============================================================
     * Sistema
     * ============================================================ */
    exportConfig() {
        const blob = new Blob([Store.exportJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${APP_INFO.slug}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Notify.show('Configuração exportada', 'SUCCESS');
    },

    importConfig(text) {
        const parsed = Store.parseImport(text);
        if (!parsed) return Notify.show('JSON inválido, ou de uma versão mais recente da app', 'WARNING');
        if (!confirm('Substituir a configuração atual pela importada?')) return;
        parsed.gallery.items = Store.get().gallery.items;     // as imagens não viajam no ficheiro: ficam as deste navegador
        Store.replace(parsed);
        Notify.show('Configuração importada', 'SUCCESS');
    },

    resetAll() {
        if (!confirm('Repor os valores de origem?\n\nIsto apaga TODAS as cenas, grupos, configurações e imagens.')) return;
        if (!confirm('Tens a certeza? Esta ação não pode ser desfeita.')) return;
        Store.reset();
        Images.clear().catch(() => {});
        Notify.show('Valores de origem repostos', 'INFO');
    }
};

$(document).ready(() => AppControl.init());
