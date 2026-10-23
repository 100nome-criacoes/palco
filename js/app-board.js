/* =====================================================================
 * AppBoard — arranque e regras da TV (index.html)
 *
 * A TV é "burra" quanto aos dados: desenha o que está no Store e reage
 * às mudanças. As únicas regras de negócio aqui são as do temporizador:
 *
 *   • Entrar numa cena de PAUSA → repõe (duração da cena ou global) e ARRANCA.
 *   • Entrar numa cena COM duração própria → repõe, parado e pronto a iniciar.
 *   • Sair da pausa para outra cena → repõe, parado.
 *   • Qualquer outra mudança de cena → o temporizador não é tocado.
 * ===================================================================== */
const AppBoard = {

    _sceneId: null,
    _wasBreak: false,
    _timerDuration: null,
    _timer: null,        // último estado publicado pelo Timer
    _alarm: false,

    init() {
        document.title = `${APP_INFO.name} — TV`;
        $('.app-credits').text(APP_INFO.credits);
        const state = Store.init();
        const scene = Scenes.live(state);
        this._sceneId = scene.id;
        this._wasBreak = scene.isBreak;
        this._timerDuration = state.timerDuration;

        Timer.init({
            seconds: Scenes.timerSeconds(state, scene),
            onUpdate: (t) => this.onTimerUpdate(t),
            onMinute: () => Notify.minute(),
            onComplete: () => this.setAlarm(true)
        });

        this.render(state);
        Store.subscribe((s) => this.onState(s));
        this.bindUi();
        Sync.startAsBoard((cmd) => this.onCommand(cmd));
    },

    /* ============================================================
     * Estado → ecrã
     * ============================================================ */
    render(state) {
        BoardView.renderScene(state);
        BoardView.renderTimerLayout(state);
        Media.render(state);
    },

    onState(state) {
        const scene = Scenes.live(state);
        const sceneChanged = scene.id !== this._sceneId;
        const wasBreak = this._wasBreak;
        const durationChanged = state.timerDuration !== this._timerDuration;

        this._sceneId = scene.id;
        this._wasBreak = scene.isBreak;
        this._timerDuration = state.timerDuration;

        this.render(state);

        if (sceneChanged) {
            if (scene.isBreak) this.startTimer(Scenes.timerSeconds(state, scene));
            else if (scene.duration || wasBreak) this.resetTimer();
        } else if (durationChanged && !Timer.isRunning() && !scene.isBreak && !scene.duration) {
            // Duração global alterada no controlo, com o temporizador parado
            Timer.set(state.timerDuration);
        }
    },

    /* ============================================================
     * Temporizador
     * ============================================================ */
    onTimerUpdate(t) {
        this._timer = t;
        BoardView.renderTimer(t);
        this.publishTimer();
    },

    /** Publica o estado do temporizador (e do alarme) para o controlo. */
    publishTimer() {
        if (this._timer) Sync.publishTimerState(Object.assign({}, this._timer, { alarm: this._alarm }));
    },

    /** Liga/desliga o alarme de fim de tempo (ecrã + som). */
    setAlarm(on) {
        this._alarm = on;
        Notify.alarm(on);
        this.publishTimer();
    },

    /** Arranca (com `seconds` se indicado; se estava a 0, recomeça do valor por defeito). */
    startTimer(seconds) {
        this.setAlarm(false);
        if (seconds) Timer.startWith(seconds);
        else if (Timer.remaining() <= 0) Timer.startWith(Scenes.timerSeconds(Store.get()));
        else Timer.start();
    },

    /** Pára e volta à duração que corresponde à cena atual. */
    resetTimer() {
        this.setAlarm(false);
        Timer.set(Scenes.timerSeconds(Store.get()));
    },

    toggleTimer() {
        if (Timer.isRunning()) Timer.pause(); else this.startTimer();
    },

    /* ============================================================
     * Comandos do controlo (só ações momentâneas)
     * ============================================================ */
    onCommand(cmd) {
        Store.reload();   // garante que agimos sobre o estado mais recente
        const p = cmd.payload || {};

        switch (cmd.type) {
            case 'timer:start':  this.startTimer(p.seconds); break;
            case 'timer:pause':  Timer.pause(); break;
            case 'timer:toggle': this.toggleTimer(); break;
            case 'timer:reset':  this.resetTimer(); break;
            case 'alarm:stop':   this.setAlarm(false); break;
            default: console.warn('Comando desconhecido:', cmd.type);
        }
    },

    /* ============================================================
     * Interação local
     * ============================================================ */
    bindUi() {
        $('#gearBtn').on('click', () => this.openControl());
        $('#breakBtn').on('click', () => Actions.toggleBreak());
        $('#fullscreenBtn').on('click', () => this.toggleFullscreen());

        $('#btStart, #ctStart').on('click', () => this.startTimer());
        $('#btPause, #ctPause').on('click', () => Timer.pause());
        $('#btReset, #ctReset').on('click', () => this.resetTimer());

        $('#closeFullscreenNotification').on('click', () => this.setAlarm(false));

        this.bindDrag();
        this.bindKeys();

        const relayout = Utils.debounce(() => {
            Media.recalcScale();
            BoardView.renderTimerLayout(Store.get());
        }, 150);
        $(window).on('resize', relayout);
        // A fonte web altera a altura do texto → reposiciona a barra compacta
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    },

    bindDrag() {
        // Timer grande: livre (x, y). Só em modo normal (em pausa/“só tempo” fica centrado).
        Draggable.attach($('#bigTimer .bt-handle')[0], $('#bigTimer')[0], {
            canDrag: () => !$('body').hasClass('break-mode') && !$('body').hasClass('layout-timer'),
            onMove: ({ x, y }) => $('#bigTimer').css({ left: x + 'px', top: y + 'px', transform: 'none' }),
            onEnd: ({ x, y }) => Store.update(d => { d.bigTimerPos = { x: Math.round(x), y: Math.round(y) }; })
        });

        // Timer compacto: só vertical, e a posição é guardada NA CENA em direto.
        // Duplo clique na pega volta à posição automática (por baixo do texto).
        const clampY = (y) => Utils.clamp(y, 8, Math.max(8, window.innerHeight - 80));
        Draggable.attach($('#compactTimer .ct-handle')[0], $('#compactTimer')[0], {
            onMove: ({ y }) => $('#compactTimer').css('top', clampY(y) + 'px'),
            onEnd: ({ y }) => Store.update(d => Scenes.update(d, d.activeSceneId, { compactY: clampY(y) }))
        });
        $('#compactTimer .ct-handle').on('dblclick', () => {
            Store.update(d => Scenes.update(d, d.activeSceneId, { compactY: null }));
        });
    },

    bindKeys() {
        $(document).on('keydown', (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // Um botão com foco reagiria também ao Espaço; tiramos-lhe o foco primeiro
            if (tag === 'BUTTON') document.activeElement.blur();

            const key = e.key.toLowerCase();
            if (key === 'p')            { e.preventDefault(); Actions.toggleBreak(); }
            else if (key === 'g')       { e.preventDefault(); this.openControl(); }
            else if (key === 'f')       { e.preventDefault(); this.toggleFullscreen(); }
            else if (e.code === 'Space'){ e.preventDefault(); this.toggleTimer(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); Actions.stepScene(1); }
            else if (e.key === 'ArrowLeft')  { e.preventDefault(); Actions.stepScene(-1); }
        });
    },

    openControl() {
        const w = window.open('control.html', Sync.CONTROL_WINDOW);
        if (w) { try { w.focus(); } catch (e) {} }
        else Notify.show('Popup bloqueado — abre control.html manualmente', 'WARNING');
    },

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {
                Notify.show('Ecrã inteiro indisponível', 'WARNING');
            });
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }
};

$(document).ready(() => AppBoard.init());
