/* =====================================================================
 * Media — desenha vídeos / site na TV (só usado em index.html)
 *
 * - Idempotente: render(state) pode correr a cada mudança de estado; só mexe
 *   numa iframe se o URL dela mudou (senão o vídeo recarregava a cada alteração).
 * - Vídeo visível → toca (com repetição). Vídeo escondido (pausa, "só tempo", modo
 *   1 vídeo, site) → pausa. O mute de cada vídeo vem do estado.
 *   Os comandos vão por postMessage (enablejsapi=1), sem recarregar a iframe.
 * - Resolução: o YouTube escolhe a qualidade pelo TAMANHO do leitor e já não
 *   aceita pedidos de HD. Por isso a iframe é criada maior (k×) e encolhida com
 *   transform: o aspeto é igual, mas o leitor "vê" um ecrã de 1080p / 720p.
 * ===================================================================== */
const Media = {

    SCALE_FACTORS: { fit: 1, fill: 1.3 },
    QUALITY_HEIGHT: { single: 1080, double: 720 },   // altura-alvo do leitor, por modo
    PUSH_DELAYS_MS: [0, 800, 2500],                  // o leitor demora a aceitar comandos

    _rendered: {},   // slot → src atualmente na iframe
    _want: {},       // slot → { muted, visible } pretendido
    _layout: 'double',
    _scale: 'cover',

    render(state) {
        const scene = Scenes.live(state);
        const mediaOn = !scene.isBreak && state.layout !== 'timer';

        this._layout = state.layout;
        this._scale = state.scales[state.layout] || 'fill';
        this._renderLayout(state.layout);

        const visible = {
            1: mediaOn && (state.layout === 'double' || state.layout === 'single'),
            2: mediaOn && state.layout === 'double'
        };
        for (const slot of [1, 2]) {
            const video = state.videos[slot];
            const id = Utils.youtubeId(video.url);
            this._setFrame(slot, id ? Utils.youtubeEmbed(id) : null);
            this._setWanted(slot, { muted: video.muted, visible: visible[slot] });
        }
        this._setFrame('Site', Utils.safeUrl(state.siteUrl));

        requestAnimationFrame(() => this.recalcScale());
    },

    _renderLayout(layout) {
        $('#boardMedia')
            .toggleClass('single', layout === 'single')
            .toggleClass('site', layout === 'site');
        $('#mediaSlotSite').toggleClass('hidden', layout !== 'site');
    },

    _setFrame(slot, src) {
        if (this._rendered[slot] === src) return;
        this._rendered[slot] = src;

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
        if (typeof slot === 'number') {
            $iframe.on('load', () => this._pushWithRetries(slot));
        }
        $frame.empty().append($iframe);
        $empty.addClass('hidden');
    },

    /* ---------- Reprodução (play/pause/mute) ---------- */

    _setWanted(slot, want) {
        const changed = JSON.stringify(this._want[slot]) !== JSON.stringify(want);
        this._want[slot] = want;
        if (changed) this._push(slot);
    },

    _command(slot, func) {
        const iframe = document.querySelector(`#mediaFrame${slot} iframe`);
        if (!iframe || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func, args: [] }),
            'https://www.youtube.com'
        );
    },

    _push(slot) {
        const want = this._want[slot];
        if (!want) return;
        this._command(slot, want.muted ? 'mute' : 'unMute');
        this._command(slot, want.visible ? 'playVideo' : 'pauseVideo');
    },

    _pushWithRetries(slot) {
        this.PUSH_DELAYS_MS.forEach(ms => setTimeout(() => this._push(slot), ms));
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
