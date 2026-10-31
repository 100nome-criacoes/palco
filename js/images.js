/* =====================================================================
 * Images — armazenamento das imagens da galeria (IndexedDB)
 *
 * - As imagens são COPIADAS para o navegador, já reduzidas (máx. 1920 px) e
 *   comprimidas. Os ficheiros originais não são tocados.
 * - O Store guarda só a lista ordenada ({ id, name, bytes }). Os dados vivem aqui.
 * - Limpeza: remover uma imagem apaga-a daqui; "apagar todas" e "repor valores de
 *   origem" limpam tudo; ao abrir o controlo, o que não está na lista é apagado
 *   (ver sweep). Nada fica a ocupar espaço depois de deixar de ser usado.
 * ===================================================================== */
const Images = {

    DB_NAME: APP_INFO.key('images'),
    STORE: 'images',
    MAX_SIDE: 1920,
    THUMB_SIDE: 240,
    QUALITY: 0.85,
    URL_CACHE_SIZE: 8,

    _db: null,
    _urls: new Map(),   // id → object URL (cache pequena; a TV só precisa da atual e da seguinte)

    /* ------------------------------ IndexedDB ------------------------------ */

    _open() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(this.STORE, { keyPath: 'id' });
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    },

    /** Corre uma operação numa transação e resolve com o resultado do pedido devolvido. */
    _run(mode, work) {
        return this._open().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, mode);
            let result;
            const request = work(tx.objectStore(this.STORE));
            if (request) request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(tx.error);
        }));
    },

    _put(record) { return this._run('readwrite', s => s.put(record)); },
    get(id)      { return this._run('readonly', s => s.get(id)).then(r => r || null); },
    keys()       { return this._run('readonly', s => s.getAllKeys()).then(k => new Set(k || [])); },

    remove(ids) {
        ids.forEach(id => this._revoke(id));
        return this._run('readwrite', s => { ids.forEach(id => s.delete(id)); });
    },

    clear() {
        [...this._urls.keys()].forEach(id => this._revoke(id));
        return this._run('readwrite', s => s.clear());
    },

    /**
     * Apaga o que está guardado mas já não está na lista (por exemplo, se o navegador
     * fechou a meio de uma importação). Ignora ids criados há menos de `minAgeMs`,
     * para nunca apagar imagens que estão a ser importadas neste momento.
     */
    async sweep(keepIds, minAgeMs = 60000) {
        const keep = new Set(keepIds);
        const stored = await this.keys();
        const now = Date.now();
        const orphans = [...stored].filter(id => !keep.has(id) && now - this._createdAt(id) > minAgeMs);
        if (orphans.length) await this.remove(orphans);
        return orphans.length;
    },

    /** Pede ao navegador para não apagar estes dados quando o disco estiver cheio. */
    requestPersistence() {
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    },

    /* ------------------------------ Ids ------------------------------ */

    /** 'i' + hora em base 36 (9 chars) + aleatório: dá para saber quando foi criado. */
    _newId() {
        return 'i' + Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 6);
    },
    _createdAt(id) {
        const t = parseInt(String(id).slice(1, 10), 36);
        return Number.isFinite(t) ? t : 0;
    },

    /* ------------------------------ Adicionar ------------------------------ */

    /**
     * Processa (reduz + comprime) e guarda um ficheiro de imagem.
     * @returns { id, name, bytes }
     */
    async add(file) {
        const { blob, thumb } = await this._process(file);
        const record = { id: this._newId(), name: file.name, blob, thumb, addedAt: Date.now() };
        await this._put(record);
        return { id: record.id, name: record.name, bytes: blob.size + (thumb ? thumb.size : 0) };
    },

    /** GIF e SVG ficam como estão (animação / vetor). O resto é reduzido a MAX_SIDE. */
    async _process(file) {
        if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
            return { blob: file, thumb: file };
        }
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        try {
            const scale = Math.min(1, this.MAX_SIDE / Math.max(bitmap.width, bitmap.height));
            const encoded = await this._encode(bitmap, scale, this.QUALITY);
            // Se já era pequena e a recompressão não ajuda, fica o original
            const blob = (scale === 1 && file.size <= encoded.size) ? file : encoded;
            const thumb = await this._encode(bitmap, this.THUMB_SIDE / Math.max(bitmap.width, bitmap.height), 0.7);
            return { blob, thumb };
        } finally {
            if (bitmap.close) bitmap.close();
        }
    },

    /** Desenha num canvas e comprime em WebP (mantém transparência); JPEG se o navegador não codifica WebP. */
    async _encode(bitmap, scale, quality) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
        canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const toBlob = (type) => new Promise(res => canvas.toBlob(res, type, quality));
        const webp = await toBlob('image/webp');
        if (webp && webp.type === 'image/webp') return webp;
        const jpeg = await toBlob('image/jpeg');
        if (!jpeg) throw new Error('Não foi possível codificar a imagem');
        return jpeg;
    },

    /* ------------------------------ URLs para mostrar ------------------------------ */

    /** URL (blob:) da imagem completa, com cache pequena. null se a imagem não existe. */
    async blobUrl(id) {
        if (this._urls.has(id)) {
            const url = this._urls.get(id);
            this._urls.delete(id);        // volta ao fim (mais recente)
            this._urls.set(id, url);
            return url;
        }
        const record = await this.get(id);
        if (!record) return null;
        const url = URL.createObjectURL(record.blob);
        this._urls.set(id, url);
        while (this._urls.size > this.URL_CACHE_SIZE) this._revoke(this._urls.keys().next().value);
        return url;
    },

    /** URL de uma miniatura. Quem chama é que o liberta (URL.revokeObjectURL). */
    async thumbUrl(id) {
        const record = await this.get(id);
        return record ? URL.createObjectURL(record.thumb || record.blob) : null;
    },

    _revoke(id) {
        const url = this._urls.get(id);
        if (url) URL.revokeObjectURL(url);
        this._urls.delete(id);
    }
};
