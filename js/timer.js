/* =====================================================================
 * Timer — motor do temporizador (sem DOM)
 *
 * Conta pelo RELÓGIO (endsAt), não por "-1 por tick". Assim o tempo
 * continua certo mesmo que o browser atrase os timers de uma janela
 * em segundo plano.
 *
 * Callbacks (passados em init):
 *   onUpdate({ remaining, running, endsAt }) — quando o segundo ou o estado mudam
 *   onMinute()                                — ao passar a ≤ 60 s
 *   onComplete()                              — ao chegar a 0
 * ===================================================================== */
const Timer = {

    TICK_MS: 250,
    MINUTE_WARNING: 60,

    _remaining: 0,
    _running: false,
    _endsAt: 0,
    _tickId: null,
    _lastKey: null,
    _cb: { onUpdate() {}, onMinute() {}, onComplete() {} },

    init({ seconds, onUpdate, onMinute, onComplete }) {
        Object.assign(this._cb, { onUpdate, onMinute, onComplete });
        this._remaining = Math.max(1, Math.round(seconds) || 900);
        this._emit(true);
    },

    remaining() { return this._remaining; },
    isRunning() { return this._running; },

    /** Define o tempo e PARA o temporizador (repor). */
    set(seconds) {
        this._stopTicking();
        this._remaining = Math.max(1, Math.round(seconds) || 1);
        this._emit(true);
    },

    start() {
        if (this._running || this._remaining <= 0) return;
        this._endsAt = Date.now() + this._remaining * 1000;
        this._running = true;
        this._tickId = setInterval(() => this._tick(), this.TICK_MS);
        this._emit(true);
    },

    /** Define o tempo e arranca. */
    startWith(seconds) {
        this.set(seconds);
        this.start();
    },

    pause() {
        if (!this._running) return;
        this._remaining = this._secondsLeft();
        this._stopTicking();
        this._emit(true);
    },

    toggle() {
        if (this._running) this.pause(); else this.start();
    },

    /* ------------------------------ Internos ------------------------------ */

    _secondsLeft() {
        return Math.max(0, Math.ceil((this._endsAt - Date.now()) / 1000));
    },

    _stopTicking() {
        clearInterval(this._tickId);
        this._tickId = null;
        this._running = false;
    },

    _tick() {
        const left = this._secondsLeft();
        const before = this._remaining;
        this._remaining = left;

        if (left <= 0) {
            this._stopTicking();
            this._emit(true);
            this._cb.onComplete();
            return;
        }
        if (before > this.MINUTE_WARNING && left <= this.MINUTE_WARNING) this._cb.onMinute();
        this._emit(false);
    },

    /** Só notifica quando algo visível mudou (ou se `force`). */
    _emit(force) {
        const key = this._remaining + ':' + this._running;
        if (!force && key === this._lastKey) return;
        this._lastKey = key;
        this._cb.onUpdate({
            remaining: this._remaining,
            running: this._running,
            endsAt: this._running ? this._endsAt : null
        });
    }
};
