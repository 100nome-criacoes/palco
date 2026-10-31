/* =====================================================================
 * ControlGallery — painel das imagens no controlo
 *
 * Importar (arrastar, escolher, pasta, colar), miniaturas, remover, apagar
 * todas, intervalo e botões anterior / pausa / seguinte (comandos à TV).
 *
 * A lista ordenada vive no Store; os dados das imagens no IndexedDB (Images).
 * Regra de limpeza: remover da lista apaga também do IndexedDB.
 * ===================================================================== */
const ControlGallery = {

    MAX_IMAGES: 300,

    _send: null,
    _busy: false,
    _sig: null,
    _thumbUrls: [],
    _renderToken: 0,

    /** @param send(type) envia um comando à TV (AppControl.sendToBoard) */
    init(send) {
        this._send = send;

        $('#pickImagesBtn').on('click', () => $('#imageFiles').trigger('click'));
        $('#pickFolderBtn').on('click', () => $('#imageFolder').trigger('click'));
        $('#imageFiles, #imageFolder').on('change', (e) => {
            this.addFiles(e.target.files);
            e.target.value = '';
        });

        this.bindDrop();
        $(document).on('paste', (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (['INPUT', 'TEXTAREA'].includes(tag)) return;
            const files = e.originalEvent.clipboardData && e.originalEvent.clipboardData.files;
            if (files && files.length) this.addFiles(files);
        });

        $('#clearImagesBtn').on('click', () => this.clearAll());
        $('#galleryInterval').on('change', (e) => {
            const { min, max, fallback } = Store.GALLERY_INTERVAL;
            const secs = Utils.clamp(parseInt(e.target.value, 10) || fallback, min, max);
            Store.update(d => { d.gallery.interval = secs; });
        });
        $('#galleryPrev').on('click', () => this._send('gallery:prev'));
        $('#galleryNext').on('click', () => this._send('gallery:next'));
        $('#galleryToggle').on('click', () => this._send('gallery:toggle'));

        this.reconcile();
    },

    /* ============================================================
     * Desenhar
     * ============================================================ */
    render(state) {
        const items = state.gallery.items;
        const bytes = items.reduce((sum, i) => sum + i.bytes, 0);
        if (!this._busy) {
            $('#galleryUsage').text(items.length
                ? `${items.length} ${items.length === 1 ? 'imagem' : 'imagens'} · ${Utils.formatBytes(bytes)}`
                : 'Sem imagens');
        }
        $('#clearImagesBtn').prop('disabled', !items.length || this._busy);

        const interval = document.getElementById('galleryInterval');
        if (document.activeElement !== interval) interval.value = state.gallery.interval;

        const sig = items.map(i => i.id).join(',');
        if (sig !== this._sig) {
            this._sig = sig;
            this.renderThumbs(items);
        }
    },

    renderThumbs(items) {
        const token = ++this._renderToken;
        this._thumbUrls.forEach(u => URL.revokeObjectURL(u));
        this._thumbUrls = [];

        const $grid = $('#thumbGrid').empty();
        items.forEach((item, index) => {
            const $img = $('<img alt="">');
            $('<div class="thumb">')
                .attr('title', item.name)
                .append($img, $('<span class="thumb-n">').text(index + 1))
                .append($('<button type="button" class="thumb-x" title="Remover imagem"><i class="fas fa-xmark"></i></button>')
                    .on('click', () => this.removeImage(item.id)))
                .appendTo($grid);

            Images.thumbUrl(item.id).then(url => {
                if (!url) return;
                if (token !== this._renderToken) return URL.revokeObjectURL(url);   // lista mudou entretanto
                this._thumbUrls.push(url);
                $img.attr('src', url);
            }).catch(() => {});
        });
    },

    /** Botões anterior / pausa / seguinte e contador, de acordo com o que a TV está a mostrar. */
    refreshTransport(state, connected) {
        const g = Sync.getGalleryState();
        const active = !!(connected && g && state.layout === 'images' && state.gallery.items.length > 0);
        $('#galleryPrev, #galleryToggle, #galleryNext').prop('disabled', !active);
        $('#galleryCounter').text(active ? `${Math.min(g.index + 1, g.total)} / ${g.total}` : '');
        $('#galleryToggle i').attr('class', active && !g.playing ? 'fas fa-play' : 'fas fa-pause');
    },

    /* ============================================================
     * Importar
     * ============================================================ */
    bindDrop() {
        const $zone = $('#imageDrop');
        const hasFiles = (e) => e.originalEvent.dataTransfer && [...e.originalEvent.dataTransfer.types].includes('Files');

        $zone.on('dragenter dragover', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            $zone.addClass('over');
        });
        $zone.on('dragleave drop', () => $zone.removeClass('over'));
        $zone.on('drop', async (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            this.addFiles(await this.collectDropped(e.originalEvent.dataTransfer));
        });
        // Largar um ficheiro fora da zona não deve abrir a imagem no navegador
        $(window).on('dragover drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

        $zone.on('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#imageFiles').trigger('click'); }
        });
    },

    /** Ficheiros largados; percorre pastas (recursivamente). Lê o DataTransfer antes de qualquer await. */
    async collectDropped(dt) {
        const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
        if (!entries.length) return [...dt.files];

        const out = [];
        const walk = async (entry) => {
            if (entry.isFile) {
                out.push(await new Promise((res, rej) => entry.file(res, rej)));
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                let batch;
                do {
                    batch = await new Promise((res, rej) => reader.readEntries(res, rej));
                    for (const child of batch) await walk(child);
                } while (batch.length);
            }
        };
        for (const entry of entries) await walk(entry);
        return out;
    },

    async addFiles(fileList) {
        if (this._busy) return Notify.show('A importar imagens. Espera um momento', 'INFO');

        let files = [...fileList].filter(f => f.type.startsWith('image/'));
        if (!files.length) return Notify.show('Não encontrei imagens', 'WARNING');
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        const room = this.MAX_IMAGES - Store.get().gallery.items.length;
        if (room <= 0) return Notify.show(`Limite de ${this.MAX_IMAGES} imagens atingido`, 'WARNING');
        const skipped = Math.max(0, files.length - room);
        files = files.slice(0, room);

        this._busy = true;
        $('#imageDrop').addClass('busy');
        Images.requestPersistence();

        const added = [];
        let failed = 0;
        for (let i = 0; i < files.length; i++) {
            $('#galleryUsage').text(`A processar ${i + 1} de ${files.length}...`);
            try { added.push(await Images.add(files[i])); }
            catch (e) { failed++; console.warn('Imagem ignorada:', files[i].name, e); }
        }

        if (added.length) Store.update(d => { d.gallery.items.push(...added); });
        this._busy = false;
        $('#imageDrop').removeClass('busy');
        this.render(Store.get());

        let msg = `${added.length} ${added.length === 1 ? 'imagem adicionada' : 'imagens adicionadas'}`;
        if (failed) msg += `, ${failed} não ${failed === 1 ? 'foi lida' : 'foram lidas'}`;
        if (skipped) msg += `, ${skipped} acima do limite`;
        if (added.length && Store.get().layout !== 'images') msg += '. Escolhe o modo "Imagens" para as mostrar';
        Notify.show(msg, failed || skipped ? 'WARNING' : 'SUCCESS', 5000);
    },

    /* ============================================================
     * Remover (apaga também do IndexedDB)
     * ============================================================ */
    async removeImage(id) {
        Store.update(d => { d.gallery.items = d.gallery.items.filter(i => i.id !== id); });
        try { await Images.remove([id]); } catch (e) { console.warn(e); }
    },

    async clearAll() {
        const n = Store.get().gallery.items.length;
        if (!n || !confirm(`Apagar ${n === 1 ? 'a imagem' : `as ${n} imagens`}? Ficam apagadas do navegador.`)) return;
        Store.update(d => { d.gallery.items = []; });
        try { await Images.clear(); } catch (e) { console.warn(e); }
        Notify.show('Imagens apagadas', 'INFO');
    },

    /**
     * Ao abrir: apaga do IndexedDB o que não está na lista (sobras de importações
     * interrompidas) e tira da lista o que já não existe no IndexedDB.
     */
    async reconcile() {
        try {
            const items = Store.get().gallery.items;
            await Images.sweep(items.map(i => i.id));
            const stored = await Images.keys();
            if (items.some(i => !stored.has(i.id))) {
                Store.update(d => { d.gallery.items = d.gallery.items.filter(i => stored.has(i.id)); });
            }
        } catch (e) { console.warn('Galeria: não consegui verificar o armazenamento.', e); }
    }
};
