/* =====================================================================
 * Notify + Alarm — avisos visuais e sinal sonoro
 * ===================================================================== */

/**
 * Sinal sonoro. Usa um único AudioContext (criar um por beep esgota o limite
 * do browser). Os browsers só permitem som depois de uma interação do
 * utilizador com a página, por isso o contexto é "desbloqueado" no 1.º clique/tecla.
 */
const Alarm = {
    _ctx: null,
    _timer: null,

    _context() {
        if (!this._ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (Ctor) this._ctx = new Ctor();
        }
        return this._ctx;
    },

    unlock() {
        const ctx = this._context();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    beep() {
        const ctx = this._context();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 1);
        } catch (e) { /* áudio indisponível */ }
    },

    start() {
        if (this._timer) return;
        this.beep();
        this._timer = setInterval(() => this.beep(), 1500);
    },

    stop() {
        clearInterval(this._timer);
        this._timer = null;
    }
};

['pointerdown', 'keydown'].forEach(evt =>
    document.addEventListener(evt, () => Alarm.unlock(), { once: true, passive: true }));


const Notify = {

    TYPES: {
        SUCCESS: { cls: '',        icon: 'fas fa-check-circle' },
        WARNING: { cls: 'warning', icon: 'fas fa-exclamation-triangle' },
        TIMER:   { cls: 'timer',   icon: 'fas fa-bell' },
        INFO:    { cls: '',        icon: 'fas fa-info-circle' }
    },

    _toastTimer: null,
    _minuteTimer: null,

    /** Toast no fundo do ecrã. */
    show(message, type = 'SUCCESS', duration = 3500) {
        const t = this.TYPES[type] || this.TYPES.SUCCESS;
        $('#notification')
            .attr('class', `notification visible ${t.cls}`)
            .html(`<i class="${t.icon}"></i> ${Utils.esc(message)}`);
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => $('#notification').removeClass('visible'), duration);
    },

    /** Aviso "falta menos de 1 minuto" (só na TV). */
    minute() {
        $('#minuteNotification').addClass('active');
        Alarm.beep();
        clearTimeout(this._minuteTimer);
        this._minuteTimer = setTimeout(() => $('#minuteNotification').removeClass('active'), 6000);
    },

    /** Alarme de fim de tempo (ecrã inteiro + som). `false` desliga. */
    alarm(on) {
        $('#fullscreenNotification').toggleClass('active', !!on);
        $('body').toggleClass('sound-active', !!on);
        if (on) Alarm.start(); else Alarm.stop();
    }
};
