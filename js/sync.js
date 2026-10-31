/* =====================================================================
 * Sync — comunicação entre a TV e o controlo (mesma origem, mesmo navegador)
 *
 * O ESTADO (cenas, cores, vídeos...) NÃO passa por aqui: vive no Store.
 * O Sync só transporta o que é momentâneo:
 *   - comandos para o temporizador da TV (iniciar, pausar, repor)
 *   - "heartbeat" (a TV está aberta?)
 *   - estado do temporizador (para o controlo mostrar)
 * ===================================================================== */
const Sync = {

    KEY_HEARTBEAT: APP_INFO.key('heartbeat'),
    KEY_COMMAND:   APP_INFO.key('cmd'),
    KEY_TIMER:     APP_INFO.key('timer_state'),
    KEY_GALLERY:   APP_INFO.key('gallery_state'),
    KEY_VIDEOS:    APP_INFO.key('videos_state'),
    CHANNEL_NAME:  APP_INFO.slug,
    BOARD_WINDOW:  APP_INFO.slug + '-tv',
    CONTROL_WINDOW: APP_INFO.slug + '-control',

    HEARTBEAT_MS: 2000,
    FRESH_MS:     6000,
    CMD_TTL_MS:   3000,

    _channel: null,
    _heartbeatId: null,
    _onCommand: null,
    _started: false,
    _seen: new Map(),   // id do comando → timestamp (deduplicação)

    _getChannel() {
        if (this._channel) return this._channel;
        if (typeof BroadcastChannel === 'undefined') return null;
        try { this._channel = new BroadcastChannel(this.CHANNEL_NAME); }
        catch (e) { this._channel = null; }
        return this._channel;
    },

    _safeParse(raw) {
        try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /* ============================ TV (board) ============================ */

    startAsBoard(onCommand) {
        this._onCommand = onCommand;
        if (this._started) return;
        this._started = true;

        this._beat();
        this._heartbeatId = setInterval(() => this._beat(), this.HEARTBEAT_MS);

        window.addEventListener('storage', (e) => {
            if (e.key === this.KEY_COMMAND && e.newValue) this._dispatch(e.newValue);
        });

        const channel = this._getChannel();
        if (channel) {
            channel.addEventListener('message', (msg) => {
                if (msg.data && msg.data.kind === 'cmd') this._dispatch(msg.data.cmd);
            });
        }

        window.addEventListener('beforeunload', () => {
            clearInterval(this._heartbeatId);
            try { localStorage.removeItem(this.KEY_HEARTBEAT); } catch (e) {}
        });
    },

    _beat() {
        try { localStorage.setItem(this.KEY_HEARTBEAT, String(Date.now())); } catch (e) {}
    },

    /**
     * Cada comando é enviado por DOIS canais (storage + BroadcastChannel) para
     * garantir entrega. Por isso chega duplicado — o `id` serve para executar uma só vez.
     */
    _dispatch(raw) {
        const cmd = typeof raw === 'string' ? this._safeParse(raw) : raw;
        if (!cmd || !cmd.type || !cmd.id) return;

        const now = Date.now();
        if (now - (cmd.ts || 0) > this.CMD_TTL_MS) return;

        for (const [id, ts] of this._seen) {
            if (now - ts > this.CMD_TTL_MS * 2) this._seen.delete(id);
        }
        if (this._seen.has(cmd.id)) return;
        this._seen.set(cmd.id, now);

        try { this._onCommand(cmd); }
        catch (e) { console.error('Erro a processar comando', cmd.type, e); }
    },

    /** A TV publica o estado do temporizador (o controlo só lê). */
    publishTimerState({ remaining, running, endsAt, alarm }) {
        try {
            localStorage.setItem(this.KEY_TIMER, JSON.stringify({
                remaining, running, endsAt, alarm: !!alarm, ts: Date.now()
            }));
        } catch (e) {}
    },

    /** A TV publica a posição da galeria (para o controlo mostrar "3 / 12"). */
    publishGalleryState({ index, total, playing }) {
        try {
            localStorage.setItem(this.KEY_GALLERY, JSON.stringify({ index, total, playing, ts: Date.now() }));
        } catch (e) {}
    },

    /** A TV publica que vídeos estão em pausa (para o botão do controlo mostrar play/pausa). */
    publishVideoState({ paused }) {
        try { localStorage.setItem(this.KEY_VIDEOS, JSON.stringify({ paused, ts: Date.now() })); } catch (e) {}
    },

    /* ============================ Controlo ============================ */

    isBoardConnected() {
        let raw = null;
        try { raw = localStorage.getItem(this.KEY_HEARTBEAT); } catch (e) {}
        const ts = parseInt(raw, 10);
        return !!ts && (Date.now() - ts) < this.FRESH_MS;
    },

    /**
     * Estado do temporizador da TV ({ remaining, running, alarm }) ou null se a TV
     * não está ligada. Se está a contar, calcula pelo relógio (endsAt) em vez de
     * confiar no último valor publicado — assim não "congela" se a TV for throttled.
     */
    getTimerState() {
        if (!this.isBoardConnected()) return null;
        let raw = null;
        try { raw = localStorage.getItem(this.KEY_TIMER); } catch (e) {}
        const t = raw && this._safeParse(raw);
        if (!t) return null;

        const remaining = (t.running && t.endsAt)
            ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000))
            : t.remaining;
        return { remaining, running: !!t.running, alarm: !!t.alarm };
    },

    /** { index, total, playing } da galeria na TV, ou null se a TV não está ligada. */
    getGalleryState() {
        if (!this.isBoardConnected()) return null;
        let raw = null;
        try { raw = localStorage.getItem(this.KEY_GALLERY); } catch (e) {}
        return (raw && this._safeParse(raw)) || null;
    },

    /** { paused: { 1, 2 } } ou null se a TV não está ligada. */
    getVideoState() {
        if (!this.isBoardConnected()) return null;
        let raw = null;
        try { raw = localStorage.getItem(this.KEY_VIDEOS); } catch (e) {}
        return (raw && this._safeParse(raw)) || null;
    },

    send(type, payload = {}) {
        const cmd = { id: Utils.uid(), type, payload, ts: Date.now() };
        try { localStorage.setItem(this.KEY_COMMAND, JSON.stringify(cmd)); } catch (e) {}
        const channel = this._getChannel();
        if (channel) {
            try { channel.postMessage({ kind: 'cmd', cmd }); } catch (e) {}
        }
    },

    /**
     * Abre a TV. Se já estiver aberta NÃO a reabre (reabrir reiniciava o temporizador).
     * @returns 'already' | 'opened' | 'blocked'
     */
    openBoard() {
        if (this.isBoardConnected()) return 'already';
        const w = window.open('index.html', this.BOARD_WINDOW);
        return w ? 'opened' : 'blocked';
    }
};
