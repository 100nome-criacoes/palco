/* =====================================================================
 * ControlPreview — miniatura da TV no painel de controlo
 *
 * Réplica a 1920x1080: usa as mesmas medidas e posições que a TV real
 * (ver .mini-* em control.css), reduzidas à largura do cartão. Mostra o tema,
 * o texto, onde está o temporizador (coluna na posição guardada, barra por
 * baixo do texto ou na posição da cena, ou em grande), e a área de media com
 * miniaturas dos vídeos e o estado do som. Só desenha; as regras de
 * visibilidade vêm de Scenes (as mesmas que a TV usa).
 *
 * Nota: assume uma TV a 1080p. Noutra resolução as proporções mantêm-se,
 * mas posições em píxeis (arrastadas) podem diferir ligeiramente.
 * ===================================================================== */
const ControlPreview = {

    TV_WIDTH: 1920,
    TV_HEIGHT: 1080,

    _mediaHtml: null,

    init() {
        // A fonte web altera a altura do texto: volta a posicionar a barra quando carregar
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => { if (Store.get()) this.render(Store.get()); });
        }
    },

    render(state) {
        const scene = Scenes.live(state);
        const theme = Scenes.theme(scene);
        const tv = document.getElementById('miniTv');

        tv.style.background = theme.bg;
        tv.style.setProperty('--scene-title', theme.title);
        tv.style.setProperty('--scene-sub', theme.sub);
        tv.style.setProperty('--scene-timer', theme.timer);
        tv.style.setProperty('--scene-muted', theme.muted);
        tv.style.setProperty('--scene-card', theme.card);
        tv.style.setProperty('--scene-card-solid', theme.cardSolid);

        $('#previewTitle').html(Utils.renderMarkdown(scene.text));
        $('#previewSubtext').html(Utils.renderMarkdown(scene.subtext));

        const mode = Scenes.effectiveTimerMode(state);
        $(tv).toggleClass('is-break', scene.isBreak)
             .toggleClass('is-timer', !scene.isBreak && state.layout === 'timer')
             .attr('data-timer', mode);

        this._renderMedia(state);
        this._placeTimers(state, scene, mode, tv);
    },

    /** Marca os vídeos em pausa na TV (estado publicado por ela). */
    setPaused(videoState) {
        const paused = (videoState && videoState.paused) || {};
        $('#miniMedia .mini-slot[data-slot]').each(function () {
            $(this).toggleClass('paused', !!paused[$(this).data('slot')]);
        });
    },

    /** Atualiza os números do temporizador (chamado a cada refresh do controlo). */
    setTime(text) {
        $('#miniTv .mini-time').text(text);
    },

    /** Posições dos temporizadores, em "px da TV" (a mesma lógica de BoardView.renderTimerLayout). */
    _placeTimers(state, scene, mode, tv) {
        const big = document.getElementById('miniBig');
        const compact = document.getElementById('miniCompact');
        const hero = scene.isBreak || state.layout === 'timer';

        if (mode === 'big' && !hero) {
            const { x, y } = state.bigTimerPos;
            big.style.left = `calc(${Math.max(0, x)} * var(--u))`;
            if (y === null) {
                big.style.top = '50%';
                big.style.transform = 'translateY(-50%)';
            } else {
                big.style.top = `calc(${Math.max(0, y)} * var(--u))`;
                big.style.transform = 'none';
            }
        } else {
            big.style.left = big.style.top = big.style.transform = '';   // em grande: o CSS centra
        }

        const auto = mode === 'compact' && scene.compactY === null;
        tv.classList.toggle('compact-auto', auto);
        if (mode === 'compact') {
            const gap = Math.round(Utils.clamp(this.TV_HEIGHT * 0.022, 16, 28));   // igual à TV
            tv.style.setProperty('--cgap', gap);
            const top = auto
                ? this._headerBottom(tv) + gap
                : Utils.clamp(scene.compactY, 8, this.TV_HEIGHT - 80);
            compact.style.top = `calc(${top} * var(--u))`;
        }
    },

    /** Fundo do texto, em px da TV. */
    _headerBottom(tv) {
        const scale = tv.clientWidth / this.TV_WIDTH;
        if (!scale) return 0;
        const header = document.getElementById('miniHeader');
        return (header.getBoundingClientRect().bottom - tv.getBoundingClientRect().top) / scale;
    },

    /* ---------- Media ---------- */
    _renderMedia(state) {
        let html = '';
        if (Scenes.mediaShown(state)) {
            if (state.layout === 'double') html = this._video(state.videos[1], 1) + this._video(state.videos[2], 2);
            else if (state.layout === 'single') html = this._video(state.videos[1], 1);
            else if (state.layout === 'site') html = this._site(state.siteUrl);
            else if (state.layout === 'images') html = this._images(state.gallery.items.length);
        }
        if (html !== this._mediaHtml) {          // não refazer (evita piscar as miniaturas)
            this._mediaHtml = html;
            $('#miniMedia').html(html);
        }
        $('#miniMedia').toggleClass('hidden', !html);
    },

    _video(video, slot) {
        const id = Utils.youtubeId(video.url);
        if (!id) return '<div class="mini-slot empty"><i class="fas fa-video"></i></div>';
        const icon = video.muted ? 'fa-volume-xmark' : 'fa-volume-high';
        return `<div class="mini-slot" data-slot="${slot}" style="background-image:url(https://img.youtube.com/vi/${id}/mqdefault.jpg)">` +
               `<i class="fas ${icon} mini-vol"></i></div>`;
    },

    _site(url) {
        const safe = Utils.safeUrl(url);
        if (!safe) return '<div class="mini-slot empty"><i class="fas fa-globe"></i></div>';
        return `<div class="mini-slot site"><i class="fas fa-globe"></i><span>${Utils.esc(new URL(safe).hostname)}</span></div>`;
    },

    _images(count) {
        if (!count) return '<div class="mini-slot empty"><i class="fas fa-images"></i></div>';
        return `<div class="mini-slot site"><i class="fas fa-images"></i><span>${count} ${count === 1 ? 'imagem' : 'imagens'}</span></div>`;
    }
};
