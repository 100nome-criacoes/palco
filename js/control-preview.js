/* =====================================================================
 * ControlPreview — miniatura da TV no painel de controlo
 *
 * Réplica do ecrã REAL da TV: a TV publica o tamanho da sua janela
 * (Sync.publishDisplay) e a miniatura usa essa proporção e esse tamanho
 * (em "px da TV", como o CSS dela). Sem TV ligada usa a última medida
 * conhecida, ou 1920x1080 se nunca houve nenhuma (e diz que é assumido).
 *
 * - Medidas e posições vêm das mesmas regras do board.css (ver metrics()).
 * - O temporizador (coluna e barra) arrasta-se aqui, em coordenadas da TV,
 *   com os mesmos limites que a TV aplica; a TV acompanha ao vivo.
 * Só desenha e converte coordenadas; as regras de visibilidade vêm de Scenes.
 * ===================================================================== */
const ControlPreview = {

    DEFAULT_TV: { w: 1920, h: 1080 },
    MAX_HEIGHT: 250,          // altura máxima da miniatura (px do ecrã do controlo)
    BIG_DEFAULT_POS: { x: 22, y: null },

    _tv: { w: 1920, h: 1080, known: false },
    _mediaHtml: null,
    _canDrag: { big: false, compact: false },

    /**
     * Tamanhos de letra base da TV (px CSS) para uma largura de janela: os `clamp()` do
     * board.css com rem = 16 px. Puro, para testes. O tamanho do texto (--ts) multiplica depois.
     */
    metrics(width) {
        const c = Utils.clamp;
        return {
            title: c(0.04 * width, 32, 57.6),        // clamp(2rem, 4vw, 3.6rem)
            sub: c(0.015 * width, 16.8, 24),         // clamp(1.05rem, 1.5vw, 1.5rem)
            breakTitle: c(0.03 * width, 28.8, 41.6), // clamp(1.8rem, 3vw, 2.6rem)
            breakSub: c(0.016 * width, 17.6, 24),    // clamp(1.1rem, 1.6vw, 1.5rem)
            hero: c(0.18 * width, 112, 224)          // clamp(7rem, 18vw, 14rem)
        };
    },

    /**
     * @param handlers { toggleMute(slot), togglePlay(slot), gallery(action) } — os mesmos comandos dos
     *        botões das linhas dos vídeos e do painel das imagens (action: 'prev' | 'toggle' | 'next')
     */
    init(handlers) {
        this._bindDrag();
        $('#miniMedia')
            .on('click', '[data-mini-mute]', (e) => handlers.toggleMute($(e.currentTarget).data('mini-mute')))
            .on('click', '[data-mini-play]', (e) => handlers.togglePlay($(e.currentTarget).data('mini-play')))
            .on('click', '[data-mini-gallery]', (e) => handlers.gallery($(e.currentTarget).data('mini-gallery')));
        const refit = Utils.debounce(() => { if (Store.get()) this.render(Store.get()); }, 150);
        $(window).on('resize', refit);
        // A fonte web altera a altura do texto: volta a posicionar a barra quando carregar
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    },

    /** Recebe o tamanho real da TV ({ width, height }) ou null. Redesenha só se mudou. */
    setDisplay(display) {
        if (!display) return;
        const w = Utils.clamp(Math.round(display.width), 320, 7680);
        const h = Utils.clamp(Math.round(display.height), 240, 4320);
        if (this._tv.known && this._tv.w === w && this._tv.h === h) return;
        this._tv = { w, h, known: true };
        if (Store.get()) this.render(Store.get());
    },

    render(state) {
        const scene = Scenes.live(state);
        const theme = Scenes.theme(scene);
        const tv = document.getElementById('miniTv');

        this._fit(tv);

        tv.style.background = theme.bg;
        tv.style.setProperty('--scene-title', theme.title);
        tv.style.setProperty('--scene-sub', theme.sub);
        tv.style.setProperty('--scene-timer', theme.timer);
        tv.style.setProperty('--scene-muted', theme.muted);
        tv.style.setProperty('--scene-card', theme.card);
        tv.style.setProperty('--scene-card-solid', theme.cardSolid);
        const size = Scenes.TEXT_SIZES[state.textSize] || Scenes.TEXT_SIZES.normal;
        tv.style.setProperty('--ts', size.title);
        tv.style.setProperty('--ts-sub', size.sub);

        const m = this.metrics(this._tv.w);
        tv.style.setProperty('--m-title', m.title);
        tv.style.setProperty('--m-sub', m.sub);
        tv.style.setProperty('--m-btitle', m.breakTitle);
        tv.style.setProperty('--m-bsub', m.breakSub);
        tv.style.setProperty('--m-hero', m.hero);

        $('#previewTitle').html(Utils.renderMarkdown(scene.text));
        $('#previewSubtext').html(Utils.renderMarkdown(scene.subtext));

        const mode = Scenes.effectiveTimerMode(state);
        $(tv).toggleClass('is-break', scene.isBreak)
             .toggleClass('is-timer', !scene.isBreak && state.layout === 'timer')
             .attr('data-timer', mode);

        this._renderMedia(state);
        this._placeTimers(state, scene, mode, tv);

        $('#tvSize').text(`${this._tv.w}×${this._tv.h}${this._tv.known ? '' : ' (assumido)'}`)
            .attr('title', this._tv.known ? 'Tamanho real da janela da TV' : 'A TV ainda não indicou o seu tamanho: a assumir 1080p');
    },

    /** Proporção e tamanho da miniatura = os da TV; --u = 1 px da TV. */
    _fit(tv) {
        const { w, h } = this._tv;
        // width:100% vem do CSS (respeita o padding do cartão); aqui só se limita a altura
        tv.style.maxWidth = `${Math.round(this.MAX_HEIGHT * (w / h))}px`;
        tv.style.aspectRatio = `${w} / ${h}`;
        tv.style.setProperty('--u', `calc(100cqw / ${w})`);
    },

    /** px da miniatura por px da TV. */
    _scale(tv) {
        return tv.clientWidth / this._tv.w || 1;
    },

    /** "3 / 12" (imagem atual / total); "– / 12" enquanto a TV não diz em que imagem vai. Puro. */
    counterText(galleryState, total) {
        if (!galleryState || !(galleryState.total > 0)) return `– / ${total}`;
        return `${Math.min(galleryState.index + 1, galleryState.total)} / ${galleryState.total}`;
    },

    /** Controlos das imagens: contador, ícone play/pausa e se estão ativos (TV ligada). */
    setGallery(galleryState, active) {
        const $gal = $('#miniMedia .mini-slot.gallery');
        if (!$gal.length) return;
        const total = Store.get().gallery.items.length;
        $gal.find('.mini-gal-counter').text(this.counterText(active ? galleryState : null, total));
        $gal.find('[data-mini-gallery]').prop('disabled', !active);
        const playing = !galleryState || galleryState.playing !== false;
        $gal.find('[data-mini-gallery="toggle"]')
            .toggleClass('is-paused', active && !playing)
            .attr('title', playing ? 'Pausar a passagem das imagens' : 'Continuar a passar as imagens')
            .find('i').attr('class', active && !playing ? 'fas fa-play' : 'fas fa-pause');
    },

    /** Atualiza os números do temporizador (chamado a cada refresh do controlo). */
    setTime(text) {
        $('#miniTv .mini-time').text(text);
    },

    /** Estado de reprodução dos vídeos (publicado pela TV): ícone e destaque do botão play/pausa. */
    setPaused(videoState, connected) {
        const paused = (videoState && videoState.paused) || {};
        $('#miniMedia .mini-slot[data-slot]').each(function () {
            const slot = $(this).data('slot');
            const isPaused = !!paused[slot];
            $(this).toggleClass('paused', isPaused);
            $(this).find('.mini-play')
                .toggleClass('is-paused', isPaused)
                .prop('disabled', !connected)
                .attr('title', `Vídeo ${slot} ${isPaused ? 'em pausa (clica para retomar)' : 'a tocar (clica para pausar)'}`)
                .find('i').attr('class', isPaused ? 'fas fa-play' : 'fas fa-pause');
        });
    },

    /* ============================================================
     * Posições dos temporizadores (a mesma lógica de BoardView.renderTimerLayout)
     * ============================================================ */
    _placeTimers(state, scene, mode, tv) {
        const big = document.getElementById('miniBig');
        const compact = document.getElementById('miniCompact');
        const hero = scene.isBreak || state.layout === 'timer';
        const { w, h } = this._tv;
        const s = this._scale(tv);

        this._canDrag.big = mode === 'big' && !hero;
        this._canDrag.compact = mode === 'compact';
        big.classList.toggle('draggable', this._canDrag.big);
        compact.classList.toggle('draggable', this._canDrag.compact);

        if (this._canDrag.big) {
            // Igual à TV: a posição é uma fração do espaço livre (ver BoardView._applyBigPos)
            const { fx, fy } = state.bigTimerPos;
            const x = Utils.fractionToPx(fx, w - big.offsetWidth / s);
            big.style.left = `calc(${x} * var(--u))`;
            if (fy === null) {
                big.style.top = '50%';
                big.style.transform = 'translateY(-50%)';
            } else {
                big.style.top = `calc(${Utils.fractionToPx(fy, h - big.offsetHeight / s)} * var(--u))`;
                big.style.transform = 'none';
            }
        } else {
            big.style.left = big.style.top = big.style.transform = '';   // em grande: o CSS centra
        }

        const auto = mode === 'compact' && scene.compactFy === null;
        tv.classList.toggle('compact-auto', auto);
        if (mode === 'compact') {
            const gap = Math.round(Utils.clamp(h * 0.022, 16, 28));       // igual à TV
            tv.style.setProperty('--cgap', gap);
            tv.style.setProperty('--chh', Math.round(compact.offsetHeight / s) || 50);
            const top = auto ? this._headerBottom(tv, s) + gap : Utils.compactTop(scene.compactFy, h);
            compact.style.top = `calc(${top} * var(--u))`;
        }
    },

    /** Fundo do texto, em px da TV. */
    _headerBottom(tv, s) {
        const header = document.getElementById('miniHeader');
        return (header.getBoundingClientRect().bottom - tv.getBoundingClientRect().top) / s;
    },

    _clampBig(x, y, big, s) {
        return {
            x: Utils.clamp(x, 0, Math.max(0, this._tv.w - big.offsetWidth / s)),
            y: Utils.clamp(y, 0, Math.max(0, this._tv.h - big.offsetHeight / s))
        };
    },

    _clampCompactY(y) {
        return Utils.clamp(y, 8, Math.max(8, this._tv.h - 80));            // igual à TV
    },

    /* ============================================================
     * Arrastar na miniatura → coordenadas da TV (gravadas como fração do espaço livre)
     * ============================================================ */
    _bindDrag() {
        const tv = document.getElementById('miniTv');
        const big = document.getElementById('miniBig');
        const compact = document.getElementById('miniCompact');
        const readout = document.getElementById('miniReadout');

        // posição (canto sup. esq.) do elemento no ecrã → px da TV
        const toTv = (clientX, clientY) => {
            const r = tv.getBoundingClientRect();
            const s = this._scale(tv);
            return { x: (clientX - r.left) / s, y: (clientY - r.top) / s, s };
        };
        const show = (text) => { readout.textContent = text; readout.classList.add('on'); };
        const hide = () => readout.classList.remove('on');

        const bigAt = (clientX, clientY) => {
            const p = toTv(clientX, clientY);
            const c = this._clampBig(p.x, p.y, big, p.s);
            return {
                x: Math.round(c.x), y: Math.round(c.y),
                fx: Utils.pxToFraction(c.x, this._tv.w - big.offsetWidth / p.s),
                fy: Utils.pxToFraction(c.y, this._tv.h - big.offsetHeight / p.s)
            };
        };
        Draggable.attach(big, big, {
            canDrag: () => this._canDrag.big,
            onMove: ({ x, y }) => {
                const c = bigAt(x, y);
                big.style.left = `calc(${c.x} * var(--u))`;
                big.style.top = `calc(${c.y} * var(--u))`;
                big.style.transform = 'none';
                show(`x ${c.x} · y ${c.y}`);
            },
            onEnd: ({ x, y }) => {
                hide();
                const c = bigAt(x, y);
                Store.update(d => { d.bigTimerPos = { fx: c.fx, fy: c.fy }; });
            }
        });

        const compactAt = (clientY) => Math.round(this._clampCompactY(toTv(0, clientY).y));
        Draggable.attach(compact, compact, {
            canDrag: () => this._canDrag.compact,
            onMove: ({ y }) => {
                const top = compactAt(y);
                compact.style.top = `calc(${top} * var(--u))`;
                show(`y ${top}`);
            },
            onEnd: ({ y }) => {
                hide();
                const fy = Utils.compactFraction(compactAt(y), this._tv.h);
                Store.update(d => Scenes.update(d, d.activeSceneId, { compactFy: fy }));
            }
        });

        // Duplo clique: repõe a posição automática (barra: por baixo do texto; coluna: à esquerda, ao centro)
        $(compact).on('dblclick', () => {
            if (this._canDrag.compact) Store.update(d => Scenes.update(d, d.activeSceneId, { compactFy: null }));
        });
        $(big).on('dblclick', () => {
            if (this._canDrag.big) Store.update(d => { d.bigTimerPos = { fx: 0.0135, fy: null }; });
        });
    },

    /* ============================================================
     * Media
     * ============================================================ */
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
        const muteTitle = video.muted ? `Vídeo ${slot} sem som (clica para ativar)` : `Vídeo ${slot} com som (clica para silenciar)`;
        // Os mesmos controlos das linhas dos vídeos, à mão sem fazer scroll
        return `<div class="mini-slot" data-slot="${slot}" style="background-image:url(https://img.youtube.com/vi/${id}/mqdefault.jpg)">` +
               `<div class="mini-ctls">` +
               `<button type="button" class="mini-ctl" data-mini-mute="${slot}" title="${muteTitle}"><i class="fas ${icon}"></i></button>` +
               `<button type="button" class="mini-ctl mini-play" data-mini-play="${slot}" title="Pausar ou continuar o vídeo ${slot}"><i class="fas fa-pause"></i></button>` +
               `</div></div>`;
    },

    _site(url) {
        const safe = Utils.safeUrl(url);
        if (!safe) return '<div class="mini-slot empty"><i class="fas fa-globe"></i></div>';
        return `<div class="mini-slot site"><i class="fas fa-globe"></i><span>${Utils.esc(new URL(safe).hostname)}</span></div>`;
    },

    _images(count) {
        if (!count) return '<div class="mini-slot empty"><i class="fas fa-images"></i></div>';
        // Os mesmos controlos do painel das imagens, à mão sem fazer scroll
        return `<div class="mini-slot site gallery"><i class="fas fa-images"></i>` +
               `<div class="mini-ctls">` +
               `<button type="button" class="mini-ctl" data-mini-gallery="prev" title="Imagem anterior"><i class="fas fa-backward-step"></i></button>` +
               `<button type="button" class="mini-ctl mini-play" data-mini-gallery="toggle" title="Pausar a passagem das imagens"><i class="fas fa-pause"></i></button>` +
               `<button type="button" class="mini-ctl" data-mini-gallery="next" title="Imagem seguinte"><i class="fas fa-forward-step"></i></button>` +
               `<span class="mini-gal-counter">– / ${count}</span>` +
               `</div></div>`;
    }
};
