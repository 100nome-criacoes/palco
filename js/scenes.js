/* =====================================================================
 * Scenes — lógica de domínio de grupos, cenas e temas de cor
 *
 * Módulo PURO: não toca em DOM, storage nem notificações.
 * Os métodos de leitura recebem um `state`; os de escrita recebem um
 * `draft` (cópia mutável) e devem ser chamados dentro de Store.update().
 *
 * Conceitos:
 *   - "live"   = a cena que está na TV (state.activeSceneId)
 *   - "editar" = a cena aberta no painel de controlo (estado local do control,
 *                independente da live)
 * ===================================================================== */
const Scenes = {

    /** Modelos de cena. Também usados por "Restaurar texto". */
    PRESETS: {
        welcome:   { name: 'Boas-vindas', emoji: '👋', isBreak: false, duration: null,
                     text: '👋 Boas-vindas!',
                     subtext: '- Liga o computador\n- Abre o **material** da sessão' },
        start:     { name: 'Início', emoji: '🎬', isBreak: false, duration: 600,
                     text: 'Prepara o teu posto >>',
                     subtext: '✋ Precisas de ajuda? Levanta a mão.\nA sessão começa em...' },
        work:      { name: 'Trabalho', emoji: '💻', isBreak: false, duration: null,
                     text: 'Mãos à obra!', subtext: '' },
        challenge: { name: 'Desafio', emoji: '🎯', isBreak: false, duration: null,
                     text: '🎯 Desafio!', subtext: '' },
        task:      { name: 'Tarefa', emoji: '📝', isBreak: false, duration: null,
                     text: '📝 Tarefa!', subtext: '' },
        break:     { name: 'Pausa', emoji: '☕', isBreak: true, duration: 900,
                     text: '⏸️  PAUSA  ⏸️',
                     subtext: '🕐  Descansa um pouco\n💧  Bebe água\n🧘  Relaxa' }
    },

    /**
     * Tamanho do texto na TV (multiplicadores do tamanho base, que se lê bem até ~2 m
     * em subtexto e ~5 m em título num ecrã de 55"). O subtexto cresce mais do que o
     * título: é onde estão as instruções e é o que primeiro deixa de se ler ao fundo.
     * `title` também escala o temporizador.
     */
    TEXT_SIZES: {
        normal: { label: 'Normal',       title: 1,   sub: 1 },
        medium: { label: 'Médio',        title: 1.2, sub: 1.35 },
        large:  { label: 'Grande',       title: 1.4, sub: 1.7 },
        xlarge: { label: 'Muito grande', title: 1.8, sub: 2.3 }
    },

    /* ------------------------------ Cores ------------------------------ */

    _lum(hex) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    },

    /** Contraste WCAG entre duas cores #rrggbb (1 a 21). */
    contrast(a, b) {
        const [hi, lo] = [this._lum(a), this._lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    },

    /** Um tema = fundo + cores de texto/temporizador que combinam com ele. */
    _makeTheme(label, bg, title, sub, extra) {
        const dark = this._lum(bg) < 0.2;
        return Object.assign({
            label, bg, title, sub,
            timer: title,
            muted: sub,
            card: dark ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.65)',
            cardSolid: dark ? 'rgba(48,60,74,.95)' : 'rgba(255,255,255,.92)'
        }, extra || {});
    },

    /** Para uma cor livre: escolhe texto escuro ou claro, o que ler melhor. */
    themeForColor(hex) {
        const light = this.contrast(hex, '#ffffff') > this.contrast(hex, '#1f2933');
        return this._makeTheme('Personalizada', hex,
            light ? '#ffffff' : '#1f2933',
            light ? '#e3e8ee' : '#4b5963');
    },

    themeKey(scene) {
        if (scene.theme && this.THEMES[scene.theme]) return scene.theme;
        return scene.isBreak ? 'menta' : 'sol';
    },

    /** Tema efetivo de uma cena: cor livre > tema escolhido > padrão do tipo de cena. */
    theme(scene) {
        return scene.bg ? this.themeForColor(scene.bg) : this.THEMES[this.themeKey(scene)];
    },

    /* ------------------------------ Fábricas ------------------------------ */

    blank() {
        return {
            id: Utils.uid(), name: 'Nova cena', emoji: '📌',
            text: '', subtext: '', theme: null, bg: null,
            isBreak: false, duration: null, timerMode: null, compactY: null, preset: null
        };
    },

    fromPreset(key) {
        const p = this.PRESETS[key];
        return {
            id: Utils.uid(), name: p.name, emoji: p.emoji,
            text: p.text, subtext: p.subtext, theme: null, bg: null,
            isBreak: p.isBreak, duration: p.duration, timerMode: null, compactY: null, preset: key
        };
    },

    /* ------------------------------ Leitura ------------------------------ */

    /** Grupo que está em direto. */
    group(state) {
        return state.groups.find(g => g.id === state.activeGroupId) || state.groups[0];
    },

    /** Cena que está em direto. */
    live(state) {
        const g = this.group(state);
        return g.scenes.find(s => s.id === state.activeSceneId) || g.scenes[0];
    },

    /** Procura uma cena em todos os grupos → { group, scene } | null */
    locate(state, sceneId) {
        for (const group of state.groups) {
            const scene = group.scenes.find(s => s.id === sceneId);
            if (scene) return { group, scene };
        }
        return null;
    },

    /**
     * Qual temporizador a TV mostra de facto. Em pausa e no modo "só tempo" é
     * sempre o grande, independentemente da preferência (que fica intacta).
     */
    effectiveTimerMode(state) {
        const scene = this.live(state);
        if (scene.isBreak || state.layout === 'timer') return 'big';
        return scene.timerMode || state.timerMode;      // a da cena, ou a predefinida
    },

    /** A área de vídeos/site/imagens está visível? (escondida em pausa e em "só tempo") */
    mediaShown(state) {
        return !this.live(state).isBreak && state.layout !== 'timer';
    },

    /** Cor de fundo efetiva. */
    color(scene) {
        return this.theme(scene).bg;
    },

    /** Segundos do temporizador para uma cena: a duração da própria cena, ou a global. */
    timerSeconds(state, scene) {
        const s = scene || this.live(state);
        return s.duration || state.timerDuration;
    },

    /* ------------------------------ Escrita (draft) ------------------------------ */

    /**
     * Põe uma cena em direto (muda de grupo se necessário).
     * Guarda a cena anterior (só se não for pausa) para o botão "voltar da pausa".
     */
    setLive(d, sceneId) {
        const hit = this.locate(d, sceneId);
        if (!hit) return false;
        const current = this.live(d);
        if (current.id === sceneId) return false;

        if (hit.group.id === d.activeGroupId) {
            if (!current.isBreak) d.previousSceneId = current.id;
        } else {
            d.activeGroupId = hit.group.id;
            d.previousSceneId = null;
        }
        d.activeSceneId = sceneId;
        return true;
    },

    /** Avança/recua na lista do grupo em direto (circular). */
    step(d, delta) {
        const scenes = this.group(d).scenes;
        const i = Math.max(0, scenes.findIndex(s => s.id === d.activeSceneId));
        const next = scenes[(i + delta + scenes.length) % scenes.length];
        return this.setLive(d, next.id);
    },

    /**
     * Alterna pausa ⇄ cena anterior.
     * @returns 'ok' | 'noBreak' (grupo sem pausa) | 'noScene' (nada para onde voltar)
     */
    toggleBreak(d) {
        const group = this.group(d);
        const current = this.live(d);

        if (current.isBreak) {
            const back = group.scenes.find(s => s.id === d.previousSceneId && !s.isBreak)
                      || group.scenes.find(s => !s.isBreak);
            if (!back) return 'noScene';
            d.activeSceneId = back.id;
            return 'ok';
        }

        const pause = group.scenes.find(s => s.isBreak);
        if (!pause) return 'noBreak';
        d.previousSceneId = current.id;
        d.activeSceneId = pause.id;
        return 'ok';
    },

    /* ---------- Grupos ---------- */

    /** Cria um grupo com uma cena em branco. NÃO o põe em direto. */
    createGroup(d, name) {
        const title = String(name || '').trim();
        if (!title) return null;
        const group = { id: Utils.uid(), name: title, scenes: [this.blank()] };
        d.groups.push(group);
        return group;
    },

    renameGroup(d, groupId, name) {
        const group = d.groups.find(g => g.id === groupId);
        const title = String(name || '').trim();
        if (!group || !title) return false;
        group.name = title;
        return true;
    },

    /**
     * Duplica um grupo (cenas incluídas, com ids novos) logo a seguir ao original.
     * A cópia NÃO fica em direto. Devolve o novo grupo, ou null.
     */
    duplicateGroup(d, groupId) {
        const idx = d.groups.findIndex(g => g.id === groupId);
        if (idx < 0) return null;
        const source = d.groups[idx];
        const copy = {
            id: Utils.uid(),
            name: `${source.name} (cópia)`,
            scenes: source.scenes.map(s => Object.assign({}, s, { id: Utils.uid() }))
        };
        d.groups.splice(idx + 1, 0, copy);
        return copy;
    },

    /**
     * Apaga um grupo (e as suas cenas). Tem de sobrar pelo menos 1 grupo.
     * Se era o grupo em direto, a TV passa para o grupo vizinho.
     * Devolve o id do grupo vizinho, ou null se não for possível.
     */
    deleteGroup(d, groupId) {
        const idx = d.groups.findIndex(g => g.id === groupId);
        if (idx < 0 || d.groups.length <= 1) return null;

        d.groups.splice(idx, 1);
        const neighbour = d.groups[Math.max(0, idx - 1)];

        if (d.activeGroupId === groupId) {
            d.activeGroupId = neighbour.id;
            d.activeSceneId = neighbour.scenes[0].id;
            d.previousSceneId = null;
        }
        return neighbour.id;
    },

    /** Sobe (-1) ou desce (+1) um grupo na lista. */
    moveGroup(d, groupId, delta) {
        const i = d.groups.findIndex(g => g.id === groupId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= d.groups.length) return false;
        [d.groups[i], d.groups[j]] = [d.groups[j], d.groups[i]];
        return true;
    },

    /* ---------- Cenas ---------- */

    /** Cria uma cena em branco no grupo indicado. NÃO a põe em direto. */
    createScene(d, groupId) {
        const group = d.groups.find(g => g.id === groupId);
        if (!group) return null;
        const scene = this.blank();
        group.scenes.push(scene);
        return scene;
    },

    /**
     * Apaga uma cena. Devolve o id da cena vizinha (para selecionar a seguir)
     * ou null se não for possível (cada grupo precisa de pelo menos 1 cena).
     */
    deleteScene(d, sceneId) {
        const hit = this.locate(d, sceneId);
        if (!hit || hit.group.scenes.length <= 1) return null;

        const idx = hit.group.scenes.findIndex(s => s.id === sceneId);
        hit.group.scenes.splice(idx, 1);
        const neighbour = hit.group.scenes[Math.max(0, idx - 1)];

        if (d.activeSceneId === sceneId) d.activeSceneId = neighbour.id;
        if (d.previousSceneId === sceneId) d.previousSceneId = null;
        return neighbour.id;
    },

    /**
     * Move uma cena para a posição `insertAt` (índice ANTES da remoção,
     * ou seja, "inserir antes do item que está agora nesse índice").
     */
    moveScene(d, sceneId, insertAt) {
        const hit = this.locate(d, sceneId);
        if (!hit) return false;
        const scenes = hit.group.scenes;
        const from = scenes.findIndex(s => s.id === sceneId);
        let to = insertAt > from ? insertAt - 1 : insertAt;
        to = Utils.clamp(to, 0, scenes.length - 1);
        if (to === from) return false;
        scenes.splice(to, 0, scenes.splice(from, 1)[0]);
        return true;
    },

    /** Sobe (-1) ou desce (+1) uma cena na lista. */
    nudgeScene(d, sceneId, delta) {
        const hit = this.locate(d, sceneId);
        if (!hit) return false;
        const from = hit.group.scenes.findIndex(s => s.id === sceneId);
        return this.moveScene(d, sceneId, delta < 0 ? from - 1 : from + 2);
    },

    /** Atualiza campos de uma cena (lista branca). `duration` em segundos. */
    update(d, sceneId, patch) {
        const hit = this.locate(d, sceneId);
        if (!hit) return false;
        const s = hit.scene;

        if ('name' in patch) {
            const name = String(patch.name).trim();
            if (name) s.name = name;
        }
        if ('emoji' in patch)   s.emoji = String(patch.emoji).trim();
        if ('text' in patch)    s.text = String(patch.text);
        if ('subtext' in patch) s.subtext = String(patch.subtext);
        if ('isBreak' in patch) s.isBreak = !!patch.isBreak;

        // Tema e cor livre são alternativos: escolher um limpa o outro
        if ('theme' in patch) {
            s.theme = (patch.theme && this.THEMES[patch.theme]) ? patch.theme : null;
            s.bg = null;
        }
        if ('bg' in patch) {
            const ok = /^#[0-9a-f]{6}$/i.test(patch.bg);
            s.bg = ok ? String(patch.bg).toLowerCase() : null;
            if (ok) s.theme = null;
        }
        if ('duration' in patch) {
            const secs = Math.round(Number(patch.duration));
            s.duration = secs > 0 ? secs : null;
        }
        if ('timerMode' in patch) {
            s.timerMode = ['big', 'compact', 'hidden'].includes(patch.timerMode) ? patch.timerMode : null;
        }
        if ('compactY' in patch) {
            s.compactY = Number.isFinite(patch.compactY) ? Math.round(patch.compactY) : null;
        }
        return true;
    },

    /** Repõe o texto original do modelo da cena. false se a cena não tem modelo. */
    restoreDefaultText(d, sceneId) {
        const hit = this.locate(d, sceneId);
        const preset = hit && this.PRESETS[hit.scene.preset];
        if (!preset) return false;
        hit.scene.text = preset.text;
        hit.scene.subtext = preset.subtext;
        return true;
    }
};

/**
 * Paleta. Cada tema traz o fundo E as cores de texto que lhe assentam bem,
 * por isso nunca há combinações ilegíveis. `sol` e `menta` são as cores de
 * origem da app (padrão de cena normal e de pausa).
 */
Scenes.THEMES = {
    sol:       Scenes._makeTheme('Sol',        '#f2edb7', '#f15a31', '#7ab536', { muted: '#6c757d' }),
    menta:     Scenes._makeTheme('Menta',      '#b7f2dc', '#7ab536', '#7ab536', { muted: '#6c757d' }),
    amanhecer: Scenes._makeTheme('Amanhecer',  '#ffdcc0', '#c2410c', '#7a3b17'),
    ceu:       Scenes._makeTheme('Céu',        '#d3eaf7', '#0b5a8c', '#2c5f7c'),
    lavanda:   Scenes._makeTheme('Lavanda',    '#e4dbf6', '#5a2d9c', '#53407f'),
    coral:     Scenes._makeTheme('Coral',      '#fbd9d0', '#b83212', '#7a3a2b'),
    folha:     Scenes._makeTheme('Folha',      '#d9efc0', '#2f6e0e', '#40621f'),
    noite:     Scenes._makeTheme('Noite',      '#1d2733', '#ffb84d', '#d5dde6'),
    cinza:     Scenes._makeTheme('Neutro',     '#e9ecef', '#1f2933', '#4b5963'),
    contraste: Scenes._makeTheme('Alto contraste', '#ffffff', '#111827', '#374151')   // para salas grandes
};
