/* =====================================================================
 * Utils — helpers puros, sem dependências de DOM nem de outros módulos
 * ===================================================================== */
const Utils = {

    esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    },

    uid() {
        return 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
    },

    clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    },

    debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    },

    /**
     * Markdown mínimo: **negrito**, *itálico*, listas com "- " ou "* " e
     * listas numeradas ("1. " ou "1) "). O número mostrado é o que se escreveu.
     */
    renderMarkdown(text) {
        if (!text) return '';
        return String(text).split('\n').map(raw => {
            const ordered = raw.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);
            const bullet = !ordered && /^\s*[-*]\s+/.test(raw);
            const content = ordered ? ordered[2] : (bullet ? raw.replace(/^\s*[-*]\s+/, '') : raw);
            const html = Utils.esc(content)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
            if (ordered) return `<span class="md-list-item md-ordered" data-n="${ordered[1]}">${html}</span>`;
            return bullet ? `<span class="md-list-item">${html}</span>` : html;
        }).join('<br>');
    },

    /**
     * Lê uma duração escrita pelo utilizador → segundos (ou null se inválida).
     *   "5" = 5 min · "5:30" = 5 min 30 s · "5:3" = 5 min 3 s · "0:45" = 45 s
     */
    parseDuration(input, maxMinutes = 180) {
        const m = String(input == null ? '' : input).trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
        if (!m) return null;
        const secs = m[2] === undefined ? 0 : parseInt(m[2], 10);
        if (secs > 59) return null;
        const total = parseInt(m[1], 10) * 60 + secs;
        return (total > 0 && total <= maxMinutes * 60) ? total : null;
    },

    /** Inverso de parseDuration: 300 → "5", 330 → "5:30" */
    formatDuration(seconds) {
        const s = Math.round(seconds);
        return s % 60 === 0 ? String(s / 60) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },

    /** 125 → "02:05" */
    formatTime(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    },

    youtubeId(url) {
        if (!url) return null;
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];
        for (const p of patterns) {
            const m = String(url).match(p);
            if (m) return m[1];
        }
        return null;
    },

    /**
     * Embed pensado para a TV: arranca sozinho e em silêncio (único modo que os
     * browsers deixam), repete, e aceita comandos (mute/play/pause) via postMessage.
     */
    youtubeEmbed(videoId) {
        const q = [
            'autoplay=1', 'mute=1', 'loop=1', `playlist=${videoId}`,
            'rel=0', 'modestbranding=1', 'playsinline=1', 'enablejsapi=1'
        ].join('&');
        return `https://www.youtube.com/embed/${videoId}?${q}`;
    },

    /**
     * Valida um URL para usar numa iframe. Só aceita http(s).
     * Aceita também o código <iframe ...> completo (Google Slides → Embed),
     * extraindo o src. Devolve o URL normalizado ou null.
     */
    safeUrl(input) {
        let url = String(input || '').trim();
        if (!url) return null;
        const iframeSrc = url.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
        if (iframeSrc) url = iframeSrc[1];
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
        try {
            const u = new URL(url);
            return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
        } catch (e) {
            return null;
        }
    }
};
