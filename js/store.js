/* =====================================================================
 * Store — ÚNICA fonte de verdade do estado da sessão
 *
 * Como funciona:
 *   - O estado vive em localStorage (chave KEY), partilhado entre a TV
 *     (index.html) e o controlo (control.html).
 *   - Qualquer alteração passa por Store.update(mutator): lê o estado MAIS
 *     RECENTE do storage, aplica a mutação e grava. Nunca se grava uma cópia
 *     antiga, por isso as duas janelas não se sobrepõem umas às outras.
 *   - Quando a outra janela grava, o evento 'storage' dispara e o Store
 *     notifica os subscritores. Cada janela só tem de "desenhar o estado".
 * ===================================================================== */
const Store = {

    KEY: APP_INFO.key('session'),

    /**
     * Versão do FORMATO dos dados (não confundir com a versão da app).
     * Vai dentro do estado e do ficheiro exportado. Se um dia o formato mudar,
     * é por este número que se decide como converter dados antigos.
     */
    VERSION: 6,

    LAYOUTS:     ['double', 'single', 'site', 'timer'],
    SCALES:      ['fit', 'fill', 'cover'],
    DEFAULT_SCALES: { double: 'cover', single: 'fill', site: 'fit' },
    TIMER_MODES: ['big', 'compact', 'hidden'],

    state: null,
    _raw: null,
    _listeners: [],
    _listening: false,

    /* ------------------------------ Defaults ------------------------------ */

    defaults() {
        const scenes = ['welcome', 'start', 'work', 'challenge', 'task', 'break']
            .map(key => Scenes.fromPreset(key));
        const group = { id: Utils.uid(), name: 'Sessão', scenes };
        return {
            version: this.VERSION,
            groups: [group],
            activeGroupId: group.id,
            activeSceneId: scenes[0].id,
            previousSceneId: null,
            videos: {
                1: { url: '', muted: true },
                2: { url: '', muted: true }
            },
            siteUrl: '',
            layout: 'double',            // 'double' | 'single' | 'site' | 'timer'
            scales: Object.assign({}, this.DEFAULT_SCALES),   // escala guardada POR modo
            timerDuration: 900,          // segundos (duração global)
            timerMode: 'big',            // 'big' | 'compact' | 'hidden'
            bigTimerPos: { x: 22, y: null }   // (a posição do temporizador compacto é por cena)
        };
    },

    /* ------------------------------ Normalização ------------------------------ */

    /**
     * Valida e completa qualquer objeto vindo do storage ou de um import.
     * Devolve SEMPRE um estado consistente (ids ativos válidos, enums válidos...).
     * Campos desconhecidos são descartados.
     */
    normalize(input) {
        const base = this.defaults();
        const src = (input && typeof input === 'object') ? input : {};
        const str = v => (typeof v === 'string' ? v : '');
        const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
        const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

        const groups = this._normalizeGroups(src.groups);
        const d = {
            version: this.VERSION,
            groups: groups.length ? groups : base.groups,
            videos: {
                1: this._normalizeVideo(src.videos && src.videos[1]),
                2: this._normalizeVideo(src.videos && src.videos[2])
            },
            siteUrl: str(src.siteUrl),
            layout: pick(src.layout, this.LAYOUTS, base.layout),
            scales: {
                double: pick(src.scales && src.scales.double, this.SCALES, this.DEFAULT_SCALES.double),
                single: pick(src.scales && src.scales.single, this.SCALES, this.DEFAULT_SCALES.single),
                site:   pick(src.scales && src.scales.site,   this.SCALES, this.DEFAULT_SCALES.site)
            },
            timerMode:     pick(src.timerMode, this.TIMER_MODES, base.timerMode),
            timerDuration: (src.timerDuration > 0) ? Math.round(src.timerDuration) : base.timerDuration,
            bigTimerPos: {
                x: finite(src.bigTimerPos && src.bigTimerPos.x, base.bigTimerPos.x),
                y: finite(src.bigTimerPos && src.bigTimerPos.y, null)
            }
        };

        const group = d.groups.find(g => g.id === src.activeGroupId) || d.groups[0];
        d.activeGroupId = group.id;
        d.activeSceneId = group.scenes.some(s => s.id === src.activeSceneId)
            ? src.activeSceneId : group.scenes[0].id;
        d.previousSceneId = group.scenes.some(s => s.id === src.previousSceneId)
            ? src.previousSceneId : null;
        return d;
    },

    _normalizeVideo(v) {
        return { url: (v && typeof v.url === 'string') ? v.url : '', muted: !(v && v.muted === false) };
    },

    _normalizeGroups(list) {
        return (Array.isArray(list) ? list : [])
            .filter(g => g && typeof g === 'object')
            .map(g => {
                const scenes = (Array.isArray(g.scenes) ? g.scenes : [])
                    .filter(s => s && typeof s === 'object')
                    .map(s => this._normalizeScene(s));
                if (!scenes.length) scenes.push(Scenes.blank());
                return {
                    id: g.id || Utils.uid(),
                    name: (typeof g.name === 'string' && g.name.trim()) || 'Grupo',
                    scenes
                };
            });
    },

    _normalizeScene(s) {
        const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
        const name = (typeof s.name === 'string' && s.name.trim()) || 'Cena';

        const preset = (typeof s.preset === 'string' && has(Scenes.PRESETS, s.preset)) ? s.preset : null;

        return {
            id: s.id || Utils.uid(),
            name,
            emoji: typeof s.emoji === 'string' ? s.emoji : '📌',
            text: typeof s.text === 'string' ? s.text : '',
            subtext: typeof s.subtext === 'string' ? s.subtext : '',
            theme: (typeof s.theme === 'string' && has(Scenes.THEMES, s.theme)) ? s.theme : null,
            bg: /^#[0-9a-f]{6}$/i.test(s.bg) ? s.bg.toLowerCase() : null,
            isBreak: s.isBreak === true,
            duration: s.duration > 0 ? Math.round(s.duration) : null,
            compactY: Number.isFinite(s.compactY) ? Math.round(s.compactY) : null,
            preset
        };
    },

    /* ------------------------------ Acesso ao storage ------------------------------ */

    _get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },

    _parse(raw) {
        try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /** Grava se mudou. Devolve true se houve alteração. */
    _write(state) {
        const raw = JSON.stringify(state);
        if (raw === this._raw) return false;
        try { localStorage.setItem(this.KEY, raw); }
        catch (e) { console.warn('Falha ao guardar no localStorage.', e); }
        this._raw = raw;
        this.state = state;
        return true;
    },

    _emit() {
        this._listeners.forEach(cb => {
            try { cb(this.state); } catch (e) { console.error('Erro num subscritor do Store', e); }
        });
    },

    /* ------------------------------ API pública ------------------------------ */

    /** Carrega o estado guardado (ou os defaults) e começa a ouvir a outra janela. */
    init() {
        this.state = this.normalize(this._parse(this._get(this.KEY)));
        this._raw = null;
        this._write(this.state);

        if (!this._listening) {
            this._listening = true;
            window.addEventListener('storage', (e) => {
                if (e.key === this.KEY || e.key === null) this.reload();
            });
        }
        return this.state;
    },

    get() { return this.state; },

    /** Subscreve mudanças (locais e vindas da outra janela). Devolve função para cancelar. */
    subscribe(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(x => x !== cb); };
    },

    /** Relê o storage (útil antes de processar comandos). true se havia novidades. */
    reload() {
        const raw = this._get(this.KEY);
        if (raw === null || raw === this._raw) return false;
        this.state = this.normalize(this._parse(raw) || this.state);
        this._raw = raw;
        this._emit();
        return true;
    },

    /**
     * Altera o estado de forma segura:
     * lê o estado mais recente → mutator(draft) → grava → notifica.
     * Se o mutator devolver `false`, aborta sem gravar.
     * Devolve true se o estado mudou.
     */
    update(mutator) {
        const raw = this._get(this.KEY);
        const draft = this.normalize((raw !== null && this._parse(raw)) || this.state);
        if (mutator(draft) === false) return false;
        if (!this._write(draft)) return false;
        this._emit();
        return true;
    },

    /** Substitui tudo (import / reset). */
    replace(newState) {
        this._write(this.normalize(newState));
        this._emit();
    },

    reset() {
        try { localStorage.removeItem(this.KEY); } catch (e) {}
        this._raw = null;
        this.replace(this.defaults());
    },

    exportJson() {
        return JSON.stringify(this.state, null, 2);
    },

    /** Valida um JSON importado. Devolve o estado normalizado ou null. */
    parseImport(text) {
        const parsed = this._parse(text);
        if (!parsed || !Array.isArray(parsed.groups) || !parsed.groups.length) return null;
        if (parsed.version > this.VERSION) return null;   // ficheiro de uma versão mais recente da app
        return this.normalize(parsed);
    }
};
