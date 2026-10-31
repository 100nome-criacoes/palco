/* =====================================================================
 * Slideshow — galeria de imagens na TV (só usado em index.html)
 *
 * Duas camadas <img> sobrepostas fazem a transição suave. Só corre quando o
 * modo "Imagens" está visível; em pausa / "só tempo" pára, e retoma onde ia.
 * A posição e o estado (a tocar / em pausa) são publicados para o controlo.
 * ===================================================================== */
const Slideshow = {

    _layers: [],
    _front: 0,
    _ids: [],
    _index: 0,
    _shownId: null,
    _active: false,
    _playing: true,
    _intervalMs: 6000,
    _timeout: null,
    _token: 0,
    _skips: 0,

    init() {
        this._layers = $('#slideshow .slide').toArray();
    },

    /** Chamado pelo Media a cada mudança de estado. `visible` = o modo Imagens está à vista. */
    render(state, visible) {
        this._ids = state.gallery.items.map(i => i.id);
        this._intervalMs = state.gallery.interval * 1000;
        $('#slideshow').toggleClass('cover', state.scales.images !== 'fit');
        $('#mediaEmptyImages').toggleClass('hidden', this._ids.length > 0);

        this._index = Utils.clamp(this._index, 0, Math.max(0, this._ids.length - 1));
        this._active = visible && this._ids.length > 0;

        if (!this._active) {
            this._stop();
            if (!this._ids.length) this._clearLayers();
        } else if (this._ids[this._index] !== this._shownId) {
            this._show();
        } else {
            this._schedule();
        }
        this._publish();
    },

    /* ---------- Controlo remoto ---------- */
    next() { this._go(1); },
    prev() { this._go(-1); },

    toggle() {
        this._playing = !this._playing;
        if (this._playing) this._schedule(); else this._stop();
        this._publish();
    },

    _go(delta) {
        if (!this._active) return;
        const n = this._ids.length;
        this._index = (this._index + delta + n) % n;
        this._show();
    },

    /* ---------- Mostrar ---------- */
    async _show() {
        this._stop();
        const token = ++this._token;
        const id = this._ids[this._index];

        const url = await Images.blobUrl(id);
        const back = this._layers[1 - this._front];
        const loaded = url ? await this._load(back, url) : false;
        if (token !== this._token) return;            // entretanto pediram outra imagem

        if (!loaded) {                                // imagem em falta ou ilegível: salta
            this._skips++;
            if (this._skips >= this._ids.length) { this._clearLayers(); return; }
            this._index = (this._index + 1) % this._ids.length;
            return this._show();
        }
        this._skips = 0;

        back.classList.add('on');
        this._layers[this._front].classList.remove('on');
        this._front = 1 - this._front;
        this._shownId = id;

        this._preload((this._index + 1) % this._ids.length);
        this._schedule();
        this._publish();
    },

    _load(img, url) {
        return new Promise(resolve => {
            img.onload = () => {
                img.style.setProperty('--ar', (img.naturalWidth / img.naturalHeight) || 16 / 9);
                resolve(true);
            };
            img.onerror = () => resolve(false);
            img.src = url;
        });
    },

    _preload(index) {
        if (this._ids.length > 1) Images.blobUrl(this._ids[index]).then(url => { if (url) new Image().src = url; });
    },

    _clearLayers() {
        this._layers.forEach(l => { l.classList.remove('on'); l.removeAttribute('src'); });
        this._shownId = null;
    },

    /* ---------- Cadência ---------- */
    _schedule() {
        if (this._timeout || !this._active || !this._playing || this._ids.length < 2) return;
        this._timeout = setTimeout(() => { this._timeout = null; this.next(); }, this._intervalMs);
    },

    _stop() {
        clearTimeout(this._timeout);
        this._timeout = null;
    },

    _publish() {
        Sync.publishGalleryState({ index: this._index, total: this._ids.length, playing: this._playing });
    }
};
