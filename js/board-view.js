/* =====================================================================
 * BoardView — desenha o estado na TV (cena, cores, temporizador)
 * Funções de "desenhar": não alteram estado nem tomam decisões de negócio.
 * ===================================================================== */
const BoardView = {

    /** Título, subtexto, cores do tema e classes de layout da cena em direto. */
    renderScene(state) {
        const scene = Scenes.live(state);
        const theme = Scenes.theme(scene);

        $('#sceneTitle').html(Utils.renderMarkdown(scene.text));
        $('#sceneSubtext').html(Utils.renderMarkdown(scene.subtext));

        const body = document.body;
        body.style.backgroundColor = theme.bg;
        body.style.setProperty('--scene-title', theme.title);
        body.style.setProperty('--scene-sub', theme.sub);
        body.style.setProperty('--scene-timer', theme.timer);
        body.style.setProperty('--scene-muted', theme.muted);
        body.style.setProperty('--scene-card', theme.card);
        body.style.setProperty('--scene-card-solid', theme.cardSolid);
        const size = Scenes.TEXT_SIZES[state.textSize] || Scenes.TEXT_SIZES.normal;   // tamanho do texto (sala grande)
        body.style.setProperty('--ts', size.title);
        body.style.setProperty('--ts-sub', size.sub);

        $('body')
            .toggleClass('break-mode', scene.isBreak)
            .toggleClass('layout-timer', state.layout === 'timer');
    },

    /** Qual temporizador está visível e onde. */
    renderTimerLayout(state) {
        const scene = Scenes.live(state);
        const mode = Scenes.effectiveTimerMode(state);
        $('#bigTimer').toggleClass('hidden', mode !== 'big');
        $('#compactTimer').toggleClass('hidden', mode !== 'compact');

        // Barra compacta: sem posição definida para esta cena, fica logo por baixo do texto
        const auto = mode === 'compact' && scene.compactY === null;
        $('body').toggleClass('compact-auto', auto);

        if (mode === 'compact') {
            let top;
            if (auto) {
                // Espaço entre o texto e a barra: proporcional à altura do ecrã (16–28 px)
                const gap = Math.round(Utils.clamp(window.innerHeight * 0.022, 16, 28));
                document.body.style.setProperty('--compact-gap', gap + 'px');
                document.body.style.setProperty('--compact-h', ($('#compactTimer')[0].offsetHeight || 50) + 'px');
                top = document.querySelector('.board-header').getBoundingClientRect().bottom + gap;
            } else {
                top = Utils.clamp(scene.compactY, 8, Math.max(8, window.innerHeight - 80));
            }
            $('#compactTimer').css('top', top + 'px');
        }
        if (mode === 'big') this._applyBigPos(state.bigTimerPos);
    },

    _applyBigPos(pos) {
        const $el = $('#bigTimer');
        if (pos.y === null) {
            $el.css({ left: pos.x + 'px', top: '50%', transform: 'translateY(-50%)' });
            return;
        }
        const el = $el[0];
        const x = Utils.clamp(pos.x, 0, Math.max(0, window.innerWidth - el.offsetWidth));
        const y = Utils.clamp(pos.y, 0, Math.max(0, window.innerHeight - el.offsetHeight));
        $el.css({ left: x + 'px', top: y + 'px', transform: 'none' });
    },

    /** Números e botões dos dois temporizadores. */
    renderTimer({ remaining, running }) {
        $('#btTime, #ctTime').text(Utils.formatTime(remaining));
        $('#bigTimer').toggleClass('urgent', running && remaining > 0 && remaining <= Timer.MINUTE_WARNING);
        $('#btStart, #ctStart').prop('disabled', running);
        $('#btPause, #ctPause').prop('disabled', !running);
    }
};
