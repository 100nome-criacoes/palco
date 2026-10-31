/* =====================================================================
 * Media — desenha vídeos / site na TV (só usado em index.html)
 *
 * - Idempotente: render(state) pode correr a cada mudança de estado; só mexe
 *   numa iframe se o vídeo (ou URL) mudou, senão recarregava a cada alteração.
 * - Vídeo visível → toca (em repetição), a não ser que o controlo o tenha posto
 *   em pausa. Vídeo escondido (pausa, "só tempo", modo 1 vídeo, site, imagens)
 *   → pausa, e ao voltar a ficar visível retoma o que estava: toca se não o
 *   tinham pausado, fica parado se tinham. A pausa só vive em memória (não é
 *   gravada): ao recarregar a TV, tudo volta a tocar sozinho.
 *   O mute vem do estado. Os comandos vão por postMessage (enablejsapi=1).
 * - Pausa e ponto de reprodução são de cada posição (dois vídeos iguais não se
 *   misturam) e ACOMPANHAM O VÍDEO quando se trocam (isSwap). O leitor envia o
 *   tempo atual; a nova iframe arranca aí (start=), parada se estava em pausa.
 *   Se um vídeo é substituído por outro, o novo começa do início e a tocar.
 * - Resolução: o YouTube escolhe a qualidade pelo TAMANHO do leitor e já não
 *   aceita pedidos de HD. Por isso a iframe é criada maior (k×) e encolhida com
 *   transform: o aspeto é igual, mas o leitor "vê" um ecrã de 1080p / 720p.
 * ===================================================================== */
const Media = {

    YT_ORIGIN: 'https://www.youtube.com',
    SCALE_FACTORS: { fit: 1, fill: 1.3 },
    QUALITY_HEIGHT: { single: 1080, double: 720 },   // altura-alvo do leitor, por modo
    PUSH_DELAYS_MS: [0, 800, 2500],                  // o leitor demora a aceitar comandos

    _rendered: {},            // 'Site' → src atual
    _ids: {},                 // slot → id do vídeo atual
    _want: {},                // slot → { muted, visible }
    _paused: { 1: false, 2: false },   // pausados pelo controlo (só em memória)
    _clock: { 1: 0, 2: 0 },            // último tempo conhecido de cada posição (s)
    _layout: 'double',
    _scale: 'cover',

    init() {
        window.addEventListener('message', (e) => this._onMessage(e));
    },

    render(state) {
        const mediaOn = Scenes.mediaShown(state);

        this._layout = state.layout;
        this._scale = state.scales[state.layout] || 'fill';
        this._renderLayout(state.layout);

        const visible = {
            1: mediaOn && (state.layout === 'double' || state.layout === 'single'),
            2: mediaOn && state.layout === 'double'
        };
        const ids = { 1: Utils.youtubeId(state.videos[1].url), 2: Utils.youtubeId(state.videos[2].url) };
        this._followVideos(ids);
        for (const slot of [1, 2]) {
            this._setVideo(slot, ids[slot]);
            this._setWanted(slot, { muted: state.videos[slot].muted, visible: visible[slot] });
        }
        this._setSite(Utils.safeUrl(state.siteUrl));
        Slideshow.render(state, mediaOn && state.layout === 'images');

        requestAnimationFrame(() => this.recalcScale());
    },

    _renderLayout(layout) {
        $('#boardMedia')
            .toggleClass('single', layout === 'single')
            .toggleClass('site', layout === 'site')
            .toggleClass('images', layout === 'images');
        $('#mediaSlotSite').toggleClass('hidden', layout !== 'site');
    },

    /* ---------- Iframes ---------- */

    /** São os mesmos dois vídeos, com as posições trocadas? (puro, para testes) */
    isSwap(prev, next) {
        return !!prev[1] && !!prev[2] && prev[1] !== prev[2] && next[1] === prev[2] && next[2] === prev[1];
    },

    /** Antes de montar: na troca, a pausa e o tempo vão com o vídeo; se um vídeo foi substituído, o novo recomeça. */
    _followVideos(next) {
        const prev = this._ids;
        if (this.isSwap(prev, next)) {
            [this._paused[1], this._paused[2]] = [this._paused[2], this._paused[1]];
            [this._clock[1], this._clock[2]] = [this._clock[2], this._clock[1]];
            return;
        }
        for (const slot of [1, 2]) {
            if (prev[slot] !== undefined && prev[slot] !== next[slot]) {
                this._paused[slot] = false;
                this._clock[slot] = 0;
            }
        }
    },

    _setVideo(slot, id) {
        if (this._ids[slot] === id) return;
        this._ids[slot] = id;
        this._mount(slot, id ? Utils.youtubeEmbed(id, this._clock[slot] || 0, !this._paused[slot]) : null);
        this._publish();
    },

    _setSite(src) {
        if (this._rendered.Site === src) return;
        this._rendered.Site = src;
        this._mount('Site', src);
    },

    _mount(slot, src) {
        const $frame = $(`#mediaFrame${slot}`);
        const $empty = $(`#mediaEmpty${slot}`);
        if (!src) {
            $frame.empty();
            $empty.removeClass('hidden');
            return;
        }
        const $iframe = $('<iframe>').attr({
            src,
            allow: 'autoplay; fullscreen; encrypted-media',
            allowfullscreen: ''
        });
        if (typeof slot === 'number') $iframe.on('load', () => this._pushWithRetries(slot));
        $frame.empty().append($iframe);
        $empty.addClass('hidden');
    },

    /* ---------- Reprodução (play / pausa / mute) ---------- */

    _setWanted(slot, want) {
        const changed = JSON.stringify(this._want[slot]) !== JSON.stringify(want);
        this._want[slot] = want;
        if (!changed) return;
        this._push(slot);
    },

    _isPaused(slot) {
        return !!this._paused[slot];
    },

    /** Pausa ou retoma um vídeo (comando do controlo). Fora do ecrã só guarda o estado. */
    toggleVideo(slot) {
        const want = this._want[slot];
        if (!want || !this._ids[slot]) return;     // também com o vídeo fora do ecrã: fica preparado
        this._paused[slot] = !this._paused[slot];
        this._push(slot);
        this._publish();
    },

    _post(slot, message) {
        const iframe = document.querySelector(`#mediaFrame${slot} iframe`);
        if (!iframe || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(JSON.stringify(message), this.YT_ORIGIN);
    },

    _push(slot) {
        const want = this._want[slot];
        if (!want) return;
        const command = (func) => this._post(slot, { event: 'command', func, args: [] });
        this._post(slot, { event: 'listening', id: slot, channel: 'widget' });   // pede o envio do tempo atual
        command(want.muted ? 'mute' : 'unMute');
        command(want.visible && !this._isPaused(slot) ? 'playVideo' : 'pauseVideo');
    },

    _pushWithRetries(slot) {
        this.PUSH_DELAYS_MS.forEach(ms => setTimeout(() => this._push(slot), ms));
    },

    /** O leitor diz em que segundo vai; guardamo-lo para a troca não perder o ponto. */
    _onMessage(e) {
        if (e.origin !== this.YT_ORIGIN) return;
        const time = Utils.youtubeTime(e.data);
        if (time === null) return;
        for (const slot of [1, 2]) {
            const iframe = document.querySelector(`#mediaFrame${slot} iframe`);
            if (iframe && iframe.contentWindow === e.source && this._ids[slot]) this._clock[slot] = time;
        }
    },

    _publish() {
        Sync.publishVideoState({ paused: { 1: this._isPaused(1), 2: this._isPaused(2) } });
    },

    /* ---------- Escala e resolução ---------- */

    /** Recalcula escala das iframes (também ao redimensionar a janela). */
    recalcScale() {
        const preset = this._scale;
        const targetHeight = this.QUALITY_HEIGHT[this._layout] || 0;

        $('.media-frame').each((_, wrap) => {
            const iframe = wrap.querySelector('iframe');
            const w = wrap.clientWidth;
            const h = wrap.clientHeight;
            if (!iframe || w < 10 || h < 10) return;   // vazio ou escondido

            let scale;
            if (preset === 'cover') {
                const ratio = 16 / 9;
                scale = Math.max((h * ratio) / w, (w / ratio) / h, 1);
            } else {
                scale = this.SCALE_FACTORS[preset] || 1.3;
            }

            const isVideo = wrap.id !== 'mediaFrameSite';
            const k = (isVideo && targetHeight) ? Math.max(1, targetHeight / h) : 1;
            iframe.style.width = iframe.style.height = (k * 100) + '%';
            iframe.style.transform = `translate(-50%,-50%) scale(${scale / k})`;
        });
    }
};
