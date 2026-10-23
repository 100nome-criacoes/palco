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

    MODE_LABELS: { big: 'Coluna', compact: 'Barra', hidden: 'Oculto' },
    LAYOUT_LABELS: { double: '2 vídeos', single: '1 vídeo', site: 'site' },

    editingId: null,
    _dragId: null,

    init() {
        document.title = `${APP_INFO.name} — Controlo`;
        $('.app-credits').text(APP_INFO.credits);
        const state = Store.init();
        this.editingId = state.activeSceneId;

        this.buildSwatches();
        Store.subscribe((s) => this.onState(s));
        this.bindUi();
        this.renderAll(state);

        setInterval(() => this.refreshLive(), 500);
        this.refreshLive();
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
        this.renderEditor(state);
        this.renderMedia(state);
        this.renderTimerSettings(state);
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
        $('#stateMode').text(this.MODE_LABELS[state.timerMode] || '—');
        $('#previewTitle').html(Utils.renderMarkdown(live.text));
        $('#previewSubtext').html(Utils.renderMarkdown(live.subtext));
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
                .attr('draggable', 'true')
                .html(`<i class="fas fa-grip-vertical grip"></i><span class="emoji">${Utils.esc(s.emoji || '•')}</span>` +
                      `<span class="grow">${Utils.esc(s.name)}${badge}</span>${dot}`)
                .on('click', () => this.edit(s.id))
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
        $('#scaleSegmented').toggleClass('disabled', !scaleApplies);
        this.markActive('#scaleSegmented', 'scale', scaleApplies ? state.scales[state.layout] : null);
        const defaultScale = scaleApplies ? Store.DEFAULT_SCALES[state.layout] : null;
        $('#scaleSegmented button').each(function () {
            $(this).toggleClass('is-default', $(this).data('scale') === defaultScale);
        });
        $('#scaleModeLabel').text(scaleApplies ? `· modo ${this.LAYOUT_LABELS[state.layout]}` : '· não se aplica a "só tempo"');

        for (const slot of [1, 2]) {
            const video = state.videos[slot];
            this.setField($(`#video${slot}Url`), video.url);
            const $btn = $(`[data-toggle-mute="${slot}"]`).toggleClass('muted', video.muted);
            $btn.find('i').attr('class', video.muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high');
            $btn.attr('title', video.muted ? `Vídeo ${slot} sem som (clica para ativar)` : `Vídeo ${slot} com som (clica para silenciar)`);
        }
        this.setField($('#siteUrl'), state.siteUrl);
    },

    renderTimerSettings(state) {
        this.markActive('#timerModeSegmented', 'timer-mode', state.timerMode);
        this.setField($('#timerMinutes'), Utils.formatDuration(state.timerDuration));
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
            $('#remoteTime').text(Utils.formatTime(t.remaining));
            $('#remoteStatus').text(t.running ? 'a contar' : 'parado').toggleClass('running', t.running);
            $('#stateTimer').text(Utils.formatTime(t.remaining) + (t.running ? ' ▶' : ' ⏸'));
        } else {
            $('#remoteTime').text(Utils.formatTime(Scenes.timerSeconds(state)));
            $('#remoteStatus').text('desligado').removeClass('running');
            $('#stateTimer').text('—');
        }

        // Botões de acordo com o estado real do temporizador
        $('#remoteStart').prop('disabled', !t || t.running);
        $('#remotePause').prop('disabled', !t || !t.running);
        $('#remoteReset').prop('disabled', !t);
        $('.preset-btn, #applyCustomBtn').prop('disabled', !connected);

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
            return Notify.show('TV não detetada — abre a TV primeiro', 'WARNING');
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
            else if (result === 'blocked') Notify.show('Popup bloqueado — abre index.html manualmente', 'WARNING');
            else setTimeout(() => this.refreshLive(), 600);
        });
    },

    bindTimer() {
        $('#remoteStart').on('click', () => this.sendToBoard('timer:start', {}));
        $('#remotePause').on('click', () => this.sendToBoard('timer:pause', {}));
        $('#remoteReset').on('click', () => this.sendToBoard('timer:reset', {}));
        $('#alarmBtn').on('click', () => this.sendToBoard('alarm:stop', {}));

        $('.preset-btn').on('click', (e) => {
            this.startTimerWithSeconds(parseInt($(e.currentTarget).data('secs'), 10));
        });

        // Personalizado: "5", "5:30", "5:3"
        $('#customMinutes').on('input', (e) => {
            const raw = e.target.value.trim();
            const secs = Utils.parseDuration(raw);
            $('#customPreview').text(!raw ? '' : (secs ? `→ ${Utils.formatTime(secs)}` : 'inválido'))
                .toggleClass('bad', !!raw && !secs);
        });
        $('#applyCustomBtn').on('click', () => {
            const secs = Utils.parseDuration($('#customMinutes').val());
            if (!secs) return Notify.show('Usa minutos (5) ou min:seg (5:30), até 180 min', 'WARNING');
            this.startTimerWithSeconds(secs);
        });
        $('#customMinutes').on('keydown', (e) => {
            if (e.key === 'Enter') $('#applyCustomBtn').trigger('click');
        });

        // Configuração global do temporizador
        $('#timerModeSegmented').on('click', 'button', (e) => {
            const mode = $(e.currentTarget).data('timer-mode');
            Store.update(d => { d.timerMode = mode; });
        });
        const setGlobal = () => {
            const secs = Utils.parseDuration($('#timerMinutes').val());
            if (!secs) return Notify.show('Usa minutos (15) ou min:seg (7:30), até 180 min', 'WARNING');
            Store.update(d => { d.timerDuration = secs; });
            Notify.show('Duração global definida', 'SUCCESS');
        };
        $('#setTimerBtn').on('click', setGlobal);
        $('#timerMinutes').on('keydown', (e) => { if (e.key === 'Enter') setGlobal(); });
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
        // A escala é guardada por modo (2 vídeos / 1 vídeo / site)
        $('#scaleSegmented').on('click', 'button', (e) => {
            const scale = $(e.currentTarget).data('scale');
            Store.update(d => { if (d.scales[d.layout] !== undefined) d.scales[d.layout] = scale; });
        });

        for (const slot of [1, 2]) {
            $(`[data-save-video="${slot}"]`).on('click', () => {
                const url = $(`#video${slot}Url`).val().trim();
                if (!Utils.youtubeId(url)) return Notify.show('URL do YouTube inválido', 'WARNING');
                Store.update(d => { d.videos[slot].url = url; });
                Notify.show('Vídeo guardado', 'SUCCESS');
            });
            $(`#video${slot}Url`).on('keydown', (e) => {
                if (e.key === 'Enter') $(`[data-save-video="${slot}"]`).trigger('click');
            });
            $(`[data-remove-video="${slot}"]`).on('click', () => {
                $(`#video${slot}Url`).val('');
                Store.update(d => { d.videos[slot].url = ''; });
                Notify.show('Vídeo removido', 'INFO');
            });
            $(`[data-toggle-mute="${slot}"]`).on('click', () => {
                Store.update(d => { d.videos[slot].muted = !d.videos[slot].muted; });
            });
        }

        // Troca os vídeos inteiros (URL + som), por isso o mute acompanha cada vídeo
        $('#swapVideosBtn').on('click', () => {
            Store.update(d => { [d.videos[1], d.videos[2]] = [d.videos[2], d.videos[1]]; });
            Notify.show('Vídeos trocados', 'SUCCESS');
        });

        $('[data-save-site]').on('click', () => {
            const url = Utils.safeUrl($('#siteUrl').val());
            if (!url) return Notify.show('URL inválido (tem de ser http ou https)', 'WARNING');
            Store.update(d => { d.siteUrl = url; d.layout = 'site'; });
            Notify.show('Site guardado', 'SUCCESS');
        });
        $('#siteUrl').on('keydown', (e) => { if (e.key === 'Enter') $('[data-save-site]').trigger('click'); });
        $('[data-remove-site]').on('click', () => {
            $('#siteUrl').val('');
            Store.update(d => {
                d.siteUrl = '';
                if (d.layout === 'site') d.layout = 'double';
            });
            Notify.show('Site removido', 'INFO');
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
        Store.replace(parsed);
        Notify.show('Configuração importada', 'SUCCESS');
    },

    resetAll() {
        if (!confirm('Repor os valores de origem?\n\nIsto apaga TODAS as cenas, grupos e configurações.')) return;
        if (!confirm('Tens a certeza? Esta ação não pode ser desfeita.')) return;
        Store.reset();
        Notify.show('Valores de origem repostos', 'INFO');
    }
};

$(document).ready(() => AppControl.init());
