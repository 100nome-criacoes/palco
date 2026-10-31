/* Testes da lógica (sem navegador):  node tests/logic.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function load(files, extra = {}) {
    const store = {};
    const listeners = [];
    const ctx = {
        console, URL, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        },
        window: { addEventListener: (t, fn) => listeners.push([t, fn]) },
        ...extra
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    for (const f of files) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8') + '\n', ctx, { filename: f });
    }
    return { ctx, store, listeners };
}
const run = (c, code) => vm.runInContext(code, c);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const queue = [];                                   // testes assíncronos correm no fim, em sequência
const testAsync = (name, fn) => queue.push([name, fn]);

/** IndexedDB mínimo em memória (só o que o Images usa): open, put, get, delete, getAllKeys, clear. */
function fakeIndexedDB() {
    const dbs = {};
    const tick = (fn) => setTimeout(fn, 0);
    const makeTx = (map) => {
        const tx = {};
        let pending = 0, done = false;
        const finish = () => { if (!done) { done = true; tick(() => tx.oncomplete && tx.oncomplete()); } };
        const request = (work) => {
            const req = {};
            pending++;
            tick(() => { req.result = work(); req.onsuccess && req.onsuccess(); if (--pending === 0) finish(); });
            return req;
        };
        tx.objectStore = () => ({
            put: (rec) => request(() => { map.set(rec.id, rec); return rec.id; }),
            get: (id) => request(() => map.get(id)),
            delete: (id) => request(() => { map.delete(id); }),
            getAllKeys: () => request(() => [...map.keys()]),
            clear: () => request(() => { map.clear(); })
        });
        setTimeout(() => { if (pending === 0) finish(); }, 1);
        return tx;
    };
    return {
        open(name) {
            const req = {};
            tick(() => {
                const fresh = !dbs[name];
                dbs[name] = dbs[name] || { stores: {} };
                req.result = {
                    createObjectStore: (store) => { dbs[name].stores[store] = new Map(); return {}; },
                    transaction: (store) => makeTx(dbs[name].stores[store])
                };
                if (fresh && req.onupgradeneeded) req.onupgradeneeded();
                req.onsuccess && req.onsuccess();
            });
            return req;
        }
    };
}

console.log('Store / Scenes');
const base = ['app-info.js', 'utils.js', 'scenes.js', 'store.js'];

test('defaults são consistentes e normalize é idempotente', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    assert.strictEqual(run(ctx, 'Scenes.live(Store.get()).name'), 'Boas-vindas');
    const again = run(ctx, 'JSON.stringify(Store.normalize(Store.get())) === JSON.stringify(Store.get())');
    assert.ok(again);
});

test('P duas vezes volta à cena de origem (bug da pausa a piscar)', () => {
    const { ctx } = load(base);
    run(ctx, `Store.init(); Actions = { toggle() { Store.update(d => Scenes.toggleBreak(d) === 'ok'); } };`);
    const start = run(ctx, 'Store.get().activeSceneId');
    run(ctx, 'Actions.toggle()');
    assert.ok(run(ctx, 'Scenes.live(Store.get()).isBreak'));
    run(ctx, 'Actions.toggle()');
    assert.strictEqual(run(ctx, 'Store.get().activeSceneId'), start);
});

test('cena criada numa janela NÃO se perde quando a outra grava (bug das cenas perdidas)', () => {
    const { ctx, store } = load(base);
    run(ctx, 'Store.init()');
    // "janela A" cria uma cena
    run(ctx, `var gid = Scenes.live(Store.get()).id && Store.get().activeGroupId;
              Store.update(d => { global_created = Scenes.createScene(d, gid); })`);
    const createdId = run(ctx, 'global_created.id');
    // "janela B" tinha estado antigo em memória; grava uma coisa qualquer
    run(ctx, `Store.state = Store.normalize(JSON.parse(JSON.stringify(Store.state)));
              Store.state.groups[0].scenes.pop(); Store._raw = 'stale';
              Store.update(d => { d.layout = 'single'; })`);
    assert.ok(run(ctx, `!!Scenes.locate(Store.get(), '${createdId}')`), 'a cena criada desapareceu');
    assert.strictEqual(run(ctx, 'Store.get().layout'), 'single');
});

test('editar cor de uma cena NÃO altera a cena em direto', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const liveBefore = run(ctx, 'Store.get().activeSceneId');
    const other = run(ctx, 'Store.get().groups[0].scenes[2].id');
    run(ctx, `Store.update(d => Scenes.update(d, '${other}', { bg: '#112233' }))`);
    assert.strictEqual(run(ctx, 'Store.get().activeSceneId'), liveBefore);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${other}').scene.bg`), '#112233');
    assert.strictEqual(run(ctx, 'Scenes.live(Store.get()).bg'), null);
});

test('posição da barra compacta é por cena (null = automática)', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const a = run(ctx, 'Store.get().groups[0].scenes[0].id'), b = run(ctx, 'Store.get().groups[0].scenes[1].id');
    run(ctx, `Store.update(d => Scenes.update(d, '${a}', { compactY: 240.4 }))`);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${a}').scene.compactY`), 240);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${b}').scene.compactY`), null);
    run(ctx, `Store.update(d => Scenes.update(d, '${a}', { compactY: null }))`);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${a}').scene.compactY`), null);
});

test('nome e ícone de cenas novas persistem', () => {
    const { ctx, store } = load(base);
    run(ctx, 'Store.init()');
    run(ctx, `Store.update(d => { sc = Scenes.createScene(d, d.activeGroupId); });
              Store.update(d => Scenes.update(d, sc.id, { name: '  Quiz final ', emoji: '🧠' }));`);
    const saved = JSON.parse(store[run(ctx, 'Store.KEY')]);
    const s = saved.groups[0].scenes.pop();
    assert.strictEqual(s.name, 'Quiz final');
    assert.strictEqual(s.emoji, '🧠');
});

test('temas: padrão por tipo, tema escolhido, cor livre com texto legível', () => {
    const { ctx } = load(base);
    assert.strictEqual(run(ctx, `Scenes.color({ bg: null, theme: null, isBreak: true })`), '#b7f2dc');
    assert.strictEqual(run(ctx, `Scenes.color({ bg: null, theme: null, isBreak: false })`), '#f2edb7');
    assert.strictEqual(run(ctx, `Scenes.color({ bg: null, theme: 'amanhecer', isBreak: true })`), '#ffdcc0');
    assert.strictEqual(run(ctx, `Scenes.theme({ bg: '#102030', isBreak: false }).title`), '#ffffff');   // fundo escuro → texto claro
    assert.strictEqual(run(ctx, `Scenes.theme({ bg: '#ffffcc', isBreak: false }).title`), '#1f2933');   // fundo claro → texto escuro
});

test('todos os temas novos têm contraste legível (título ≥3, subtexto ≥4.5)', () => {
    const { ctx } = load(base);
    const themes = JSON.parse(run(ctx, 'JSON.stringify(Scenes.THEMES)'));
    for (const [key, t] of Object.entries(themes)) {
        if (key === 'sol' || key === 'menta') continue;   // cores de origem da app (não alteradas)
        assert.ok(run(ctx, `Scenes.contrast('${t.bg}', '${t.title}')`) >= 3, `${key}: título`);
        assert.ok(run(ctx, `Scenes.contrast('${t.bg}', '${t.sub}')`) >= 4.5, `${key}: subtexto`);
    }
});

test('escolher tema limpa a cor livre e vice-versa', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const id = run(ctx, 'Store.get().groups[0].scenes[2].id');
    run(ctx, `Store.update(d => Scenes.update(d, '${id}', { bg: '#123456' }))`);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${id}').scene.theme`), null);
    run(ctx, `Store.update(d => Scenes.update(d, '${id}', { theme: 'ceu' }))`);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${id}').scene.bg`), null);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${id}').scene.theme`), 'ceu');
    run(ctx, `Store.update(d => Scenes.update(d, '${id}', { theme: 'inexistente' }))`);
    assert.strictEqual(run(ctx, `Scenes.locate(Store.get(), '${id}').scene.theme`), null);
});

test('duração: cena com duração própria usa-a; as outras usam a global', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const T = (i) => run(ctx, `Scenes.timerSeconds(Store.get(), Store.get().groups[0].scenes[${i}])`);
    assert.strictEqual(T(1), 600);     // Início: 10 min (própria, não é pausa)
    assert.strictEqual(T(2), 900);     // Trabalho: global
    assert.strictEqual(T(5), 900);     // Pausa: própria
    run(ctx, 'Store.update(d => { d.timerDuration = 1200; d.groups[0].scenes[5].duration = 300; })');
    assert.strictEqual(T(1), 600);
    assert.strictEqual(T(2), 1200);
    assert.strictEqual(T(5), 300);
});

test('parseDuration: "5", "5:30", "5:3", "0:45"; rejeita lixo e excessos', () => {
    const { ctx } = load(['utils.js']);
    const P = (v) => run(ctx, `Utils.parseDuration(${JSON.stringify(v)})`);
    assert.strictEqual(P('5'), 300);
    assert.strictEqual(P('5:30'), 330);
    assert.strictEqual(P('5:45'), 345);
    assert.strictEqual(P('5:3'), 303);
    assert.strictEqual(P('0:45'), 45);
    assert.strictEqual(P('5:'), 300);              // a meio de escrever: vale 5 min
    assert.strictEqual(P(':30'), 30);              // ":x" = 0:x
    assert.strictEqual(P(':5'), 5);
    assert.strictEqual(P(':'), null);
    assert.strictEqual(P('5:60'), null);
    assert.strictEqual(P('5:123'), null);
    assert.strictEqual(P('0'), null);
    assert.strictEqual(P('181'), null);
    assert.strictEqual(P('abc'), null);
    assert.strictEqual(P(''), null);
    assert.strictEqual(run(ctx, 'Utils.formatDuration(300)'), '5');
    assert.strictEqual(run(ctx, 'Utils.formatDuration(330)'), '5:30');
});

test('apagar a cena em direto passa a vizinha; último não apaga', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const id = run(ctx, 'Store.get().activeSceneId');
    run(ctx, `Store.update(d => { nb = Scenes.deleteScene(d, '${id}'); })`);
    assert.ok(run(ctx, `nb && Store.get().activeSceneId === nb`));
    run(ctx, `Store.update(d => { d.groups[0].scenes.splice(1); })`);
    assert.strictEqual(run(ctx, `var r; Store.update(d => { r = Scenes.deleteScene(d, d.groups[0].scenes[0].id); }); r`), null);
});

test('APP_INFO: prefixos e créditos', () => {
    const { ctx } = load(['app-info.js']);
    assert.strictEqual(run(ctx, `APP_INFO.key('cmd')`), 'palco_cmd');
    assert.strictEqual(run(ctx, 'APP_INFO.short'), `Palco ${run(ctx, 'APP_INFO.version')}`);
    assert.strictEqual(run(ctx, 'APP_INFO.issuesUrl'), run(ctx, 'APP_INFO.repo') + '/issues');
    assert.ok(run(ctx, 'APP_INFO.licenseUrl').endsWith('/blob/HEAD/LICENSE'));
});

test('trocar vídeos leva o mute junto; escala é por modo', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    run(ctx, `Store.update(d => { d.videos[1] = { url: 'A', muted: false }; d.videos[2] = { url: 'B', muted: true }; });
              Store.update(d => { [d.videos[1], d.videos[2]] = [d.videos[2], d.videos[1]]; });`);
    assert.strictEqual(run(ctx, 'Store.get().videos[1].url + Store.get().videos[1].muted'), 'Btrue');
    assert.strictEqual(run(ctx, 'Store.get().videos[2].url + Store.get().videos[2].muted'), 'Afalse');
    run(ctx, `Store.update(d => { d.layout = 'single'; d.scales.single = 'cover'; });
              Store.update(d => { d.layout = 'site'; });`);
    assert.strictEqual(run(ctx, 'Store.get().scales.site'), 'fit');
    assert.strictEqual(run(ctx, 'Store.get().scales.single'), 'cover');
});

test('reordenar cenas e grupos; renomear grupo', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const names = () => run(ctx, `Store.get().groups[0].scenes.map(s => s.name).join(',')`);
    const id = (i) => run(ctx, `Store.get().groups[0].scenes[${i}].id`);
    assert.strictEqual(names(), 'Boas-vindas,Início,Trabalho,Desafio,Tarefa,Pausa');
    run(ctx, `Store.update(d => Scenes.nudgeScene(d, '${id(2)}', -1))`);          // Trabalho sobe
    assert.strictEqual(names(), 'Boas-vindas,Trabalho,Início,Desafio,Tarefa,Pausa');
    run(ctx, `Store.update(d => Scenes.nudgeScene(d, '${id(0)}', 1))`);           // 1.ª desce
    assert.strictEqual(names(), 'Trabalho,Boas-vindas,Início,Desafio,Tarefa,Pausa');
    run(ctx, `Store.update(d => Scenes.moveScene(d, '${id(0)}', 5))`);            // arrastar p/ antes da Pausa
    assert.strictEqual(names(), 'Boas-vindas,Início,Desafio,Tarefa,Trabalho,Pausa');
    run(ctx, `Store.update(d => Scenes.moveScene(d, '${id(5)}', 0))`);            // Pausa para o topo
    assert.strictEqual(names(), 'Pausa,Boas-vindas,Início,Desafio,Tarefa,Trabalho');
    assert.strictEqual(run(ctx, `var r = true; Store.update(d => { r = Scenes.nudgeScene(d, '${id(0)}', -1); return r; }); r`), false);

    run(ctx, `Store.update(d => { Scenes.createGroup(d, 'B'); Scenes.renameGroup(d, d.groups[0].id, '  Dia 1 '); })`);
    assert.strictEqual(run(ctx, 'Store.get().groups.map(g => g.name).join(",")'), 'Dia 1,B');
    run(ctx, `Store.update(d => Scenes.moveGroup(d, d.groups[1].id, -1))`);
    assert.strictEqual(run(ctx, 'Store.get().groups.map(g => g.name).join(",")'), 'B,Dia 1');
});

test('duplicar grupo: cópia independente, ids novos, logo a seguir, fora de direto', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const g0 = run(ctx, 'Store.get().groups[0].id');
    const live = run(ctx, 'Store.get().activeSceneId');
    run(ctx, `Store.update(d => { Scenes.createGroup(d, 'Z'); })`);       // [Workshop, Z]
    run(ctx, `Store.update(d => { cp = Scenes.duplicateGroup(d, '${g0}'); })`);
    assert.strictEqual(run(ctx, 'Store.get().groups.map(g => g.name).join("|")'), 'Sessão|Sessão (cópia)|Z');
    assert.strictEqual(run(ctx, 'Store.get().groups[1].scenes.length'), 6);
    assert.strictEqual(run(ctx, 'Store.get().activeSceneId'), live);        // continua em direto o original
    const ids = run(ctx, 'JSON.stringify(Store.get().groups[0].scenes.concat(Store.get().groups[1].scenes).map(s => s.id))');
    assert.strictEqual(new Set(JSON.parse(ids)).size, 12, 'ids repetidos');
    run(ctx, `Store.update(d => { d.groups[1].scenes[0].text = 'mudei'; })`);
    assert.notStrictEqual(run(ctx, 'Store.get().groups[0].scenes[0].text'), 'mudei');   // independente
    assert.strictEqual(run(ctx, 'Store.get().groups[1].scenes[5].preset'), 'break');    // "Restaurar" continua a funcionar
});

test('apagar grupo: o último não apaga; se estava em direto, a TV passa ao vizinho', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const g0 = run(ctx, 'Store.get().groups[0].id');
    assert.strictEqual(run(ctx, `var r; Store.update(d => { r = Scenes.deleteGroup(d, '${g0}'); }); r`), null);

    run(ctx, `Store.update(d => { Scenes.createGroup(d, 'B'); Scenes.createGroup(d, 'C'); })`);
    const gB = run(ctx, 'Store.get().groups[1].id'), gC = run(ctx, 'Store.get().groups[2].id');
    // apagar um grupo que NÃO está em direto não mexe na TV
    const live = run(ctx, 'Store.get().activeSceneId');
    run(ctx, `Store.update(d => { Scenes.deleteGroup(d, '${gC}'); })`);
    assert.strictEqual(run(ctx, 'Store.get().groups.length'), 2);
    assert.strictEqual(run(ctx, 'Store.get().activeSceneId'), live);
    // apagar o grupo em direto passa a TV para o vizinho
    run(ctx, `Store.update(d => { Scenes.deleteGroup(d, '${g0}'); })`);
    assert.strictEqual(run(ctx, 'Store.get().activeGroupId'), gB);
    assert.strictEqual(run(ctx, 'Store.get().activeSceneId'), run(ctx, 'Store.get().groups[0].scenes[0].id'));
    assert.strictEqual(run(ctx, 'Store.get().previousSceneId'), null);
});

test('exportar → importar devolve EXATAMENTE o mesmo estado (nada se perde)', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    run(ctx, `Store.update(d => {
        d.layout = 'single'; d.timerDuration = 1230; d.timerMode = 'compact';
        d.videos[1] = { url: 'https://youtu.be/aaaaaaaaaaa', muted: false };
        d.videos[2] = { url: 'https://youtu.be/bbbbbbbbbbb', muted: true };
        d.siteUrl = 'https://exemplo.pt/slides';
        d.scales.single = 'cover'; d.bigTimerPos = { x: 40, y: 200 };
        const g = d.groups[0];
        g.scenes[1].duration = 630; g.scenes[1].theme = 'ceu';
        g.scenes[2].bg = '#123456'; g.scenes[3].compactY = 300;
        Scenes.createGroup(d, 'Nível 2'); Scenes.duplicateGroup(d, g.id);
    })`);
    const exported = run(ctx, 'Store.exportJson()');
    const before = run(ctx, 'JSON.stringify(Store.get())');

    run(ctx, 'Store.reset()');                                  // "computador novo"
    assert.notStrictEqual(run(ctx, 'JSON.stringify(Store.get())'), before);
    assert.ok(run(ctx, `Store.parseImport(${JSON.stringify(exported)})`), 'o ficheiro exportado foi recusado');
    run(ctx, `Store.replace(Store.parseImport(${JSON.stringify(exported)}))`);
    assert.strictEqual(run(ctx, 'JSON.stringify(Store.get())'), before);
});

test('ficheiro editado à mão é reparado em vez de rebentar', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const messy = {
        version: 6, layout: 'banana', timerMode: 'x', timerDuration: -5,
        videos: { 1: 'texto solto', 2: null }, scales: { double: 'zzz' },
        groups: [{ name: '', scenes: [{ name: '  ', bg: 'red', theme: 'nao-existe', duration: 'abc', compactY: 'x' }, 42, null] }],
        activeGroupId: 'nao-existe', activeSceneId: 'nao-existe'
    };
    run(ctx, `Store.replace(${JSON.stringify(messy)})`);
    const s = JSON.parse(run(ctx, 'JSON.stringify(Store.get())'));
    assert.strictEqual(s.layout, 'double');
    assert.strictEqual(s.timerMode, 'big');
    assert.strictEqual(s.timerDuration, 900);
    assert.deepStrictEqual(s.videos[1], { url: '', muted: true });
    assert.strictEqual(s.scales.double, 'cover');
    assert.strictEqual(s.groups[0].name, 'Grupo');
    assert.strictEqual(s.groups[0].scenes.length, 1);
    const sc = s.groups[0].scenes[0];
    assert.deepStrictEqual([sc.name, sc.bg, sc.theme, sc.duration, sc.compactY], ['Cena', null, null, null, null]);
    assert.strictEqual(s.activeSceneId, sc.id);
});

test('ficheiro de uma versão mais recente da app é recusado', () => {
    const { ctx } = load(base);
    assert.strictEqual(run(ctx, `Store.parseImport(JSON.stringify({ version: 99, groups: [{ id: 'g', name: 'G', scenes: [{ id: 's' }] }] }))`), null);
});

test('não há chaves nem migrações antigas', () => {
    const { ctx, store } = load(base);
    store['tumo_session_v6'] = JSON.stringify({ groups: [{ id: 'g', name: 'Velho', scenes: [{ id: 's' }] }] });
    run(ctx, 'Store.init()');
    assert.notStrictEqual(run(ctx, 'Store.get().groups[0].name'), 'Velho');   // dados antigos são ignorados
    assert.strictEqual(run(ctx, 'Store.KEY'), 'palco_session');
});

test('importação inválida é rejeitada; reset repõe defaults', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    assert.strictEqual(run(ctx, `Store.parseImport('{"x":1}')`), null);
    assert.strictEqual(run(ctx, `Store.parseImport('lixo')`), null);
    run(ctx, `Store.update(d => { d.groups = d.groups.slice(0,1); d.groups[0].name = 'X'; }); Store.reset();`);
    assert.strictEqual(run(ctx, 'Store.get().groups[0].name'), 'Sessão');
});

test('markdown: listas numeradas usam o número escrito; "2024. x" e texto normal não são listas', () => {
    const { ctx } = load(['utils.js']);
    const md = (t) => run(ctx, `Utils.renderMarkdown(${JSON.stringify(t)})`);
    assert.strictEqual(md('1. Abre **isto**'), '<span class="md-list-item md-ordered" data-n="1">Abre <strong>isto</strong></span>');
    assert.ok(md('3) terceiro').includes('data-n="3"'));
    assert.ok(md('10. dez').includes('data-n="10"'));
    assert.ok(!md('2024. foi um ano').includes('md-ordered'));
    assert.ok(!md('Chegou 1. vez').includes('md-ordered'));
    assert.ok(md('- ponto').includes('md-list-item') && !md('- ponto').includes('md-ordered'));
    assert.ok(!md('1. <b>x</b>').includes('<b>'));        // continua escapado
});

test('safeUrl: só http(s); extrai src de <iframe>', () => {
    const { ctx } = load(['utils.js']);
    assert.strictEqual(run(ctx, `Utils.safeUrl('javascript:alert(1)')`), null);
    assert.strictEqual(run(ctx, `Utils.safeUrl('exemplo.pt/x')`), 'https://exemplo.pt/x');
    assert.strictEqual(run(ctx, `Utils.safeUrl('<iframe width="1" src="https://docs.google.com/p/embed?a=1&b=2"></iframe>')`),
        'https://docs.google.com/p/embed?a=1&b=2');
});


console.log('Galeria e pré-visualização');
test('galeria: normalização, intervalo limitado e modo "images" aceite', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const messy = {
        layout: 'images',
        gallery: { interval: 99999, items: [{ id: 'a', name: 'um.jpg', bytes: 1000 }, { id: '' }, null, { id: 'b', bytes: 'x' }, 7] },
        scales: { images: 'cover' }
    };
    run(ctx, `Store.replace(${JSON.stringify(messy)})`);
    const s = JSON.parse(run(ctx, 'JSON.stringify(Store.get())'));
    assert.strictEqual(s.layout, 'images');
    assert.strictEqual(s.gallery.interval, 300);
    assert.deepStrictEqual(s.gallery.items, [{ id: 'a', name: 'um.jpg', bytes: 1000 }, { id: 'b', name: '', bytes: 0 }]);
    assert.strictEqual(s.scales.images, 'cover');
    run(ctx, `Store.replace({ gallery: { interval: 1 } })`);
    assert.strictEqual(run(ctx, 'Store.get().gallery.interval'), 2);
    run(ctx, `Store.replace({})`);
    assert.strictEqual(run(ctx, 'Store.get().gallery.interval'), 6);
    assert.strictEqual(run(ctx, 'Store.get().scales.images'), 'fit');
});

test('exportar não leva as imagens (só as definições); importar não as traz de volta', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    run(ctx, `Store.update(d => { d.gallery.items = [{ id: 'x1', name: 'a.jpg', bytes: 10 }]; d.gallery.interval = 9; })`);
    const exported = JSON.parse(run(ctx, 'Store.exportJson()'));
    assert.deepStrictEqual(exported.gallery.items, []);
    assert.strictEqual(exported.gallery.interval, 9);
    assert.strictEqual(run(ctx, 'Store.get().gallery.items.length'), 1);        // o estado em memória não foi tocado
    const parsed = JSON.parse(run(ctx, `JSON.stringify(Store.parseImport(${JSON.stringify(JSON.stringify(exported))}))`));
    assert.deepStrictEqual(parsed.gallery.items, []);
});

test('Scenes.mediaShown e effectiveTimerMode (as regras que a TV e a miniatura partilham)', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    assert.strictEqual(run(ctx, 'Scenes.mediaShown(Store.get())'), true);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'big');
    run(ctx, `Store.update(d => { d.timerMode = 'compact'; })`);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'compact');
    run(ctx, `Store.update(d => { d.layout = 'timer'; })`);
    assert.strictEqual(run(ctx, 'Scenes.mediaShown(Store.get())'), false);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'big');       // "só tempo" força o grande
    run(ctx, `Store.update(d => { d.layout = 'images'; Scenes.toggleBreak(d); })`);
    assert.strictEqual(run(ctx, 'Scenes.mediaShown(Store.get())'), false);                // em pausa não há media
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'big');
});

test('YouTube: embed com início e leitura do tempo enviado pelo leitor', () => {
    const { ctx } = load(['utils.js']);
    const e = (t) => run(ctx, `Utils.youtubeEmbed('abcdefghijk', ${t})`);
    assert.ok(e(0).includes('start=0') && e(0).includes('loop=1') && e(0).includes('mute=1'));
    assert.ok(e(42.9).includes('start=42'));
    assert.ok(e(-5).includes('start=0'));
    assert.ok(e(0).includes('autoplay=1'));
    assert.ok(run(ctx, `Utils.youtubeEmbed('abcdefghijk', 10, false)`).includes('autoplay=0'));   // vídeo que estava em pausa
    const T = (v) => run(ctx, `Utils.youtubeTime(${JSON.stringify(v)})`);
    assert.strictEqual(T(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12.5 } })), 12.5);
    assert.strictEqual(T({ event: 'infoDelivery', info: { currentTime: 0 } }), 0);
    assert.strictEqual(T(JSON.stringify({ event: 'onReady' })), null);
    assert.strictEqual(T(JSON.stringify({ event: 'infoDelivery', info: { playerState: 1 } })), null);
    assert.strictEqual(T('não é json'), null);
    assert.strictEqual(T(null), null);
});

test('temporizador por cena: a da cena manda; sem definição própria usa a predefinida', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    const id = run(ctx, 'Store.get().groups[0].scenes[2].id');           // "Trabalho"
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'big');   // cena 1 (sem definição) → predefinida
    run(ctx, `Store.update(d => { d.timerMode = 'compact'; })`);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'compact');
    run(ctx, `Store.update(d => { Scenes.update(d, d.activeSceneId, { timerMode: 'hidden' }); })`);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'hidden');           // própria da cena
    run(ctx, `Store.update(d => { Scenes.setLive(d, '${id}'); })`);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'compact');          // outra cena: predefinida
    run(ctx, `Store.update(d => { Scenes.update(d, d.activeSceneId, { timerMode: 'big' }); d.layout = 'timer'; })`);
    assert.strictEqual(run(ctx, 'Scenes.effectiveTimerMode(Store.get())'), 'big');
    run(ctx, `Store.update(d => { d.layout = 'double'; Scenes.update(d, d.activeSceneId, { timerMode: 'lixo' }); })`);
    assert.strictEqual(run(ctx, 'Scenes.live(Store.get()).timerMode'), null);                   // valor inválido → volta ao padrão
    run(ctx, `Store.replace({ groups: [{ id: 'g', name: 'G', scenes: [{ id: 's', timerMode: 'compact' }, { id: 't', timerMode: 'xx' }] }] })`);
    assert.deepStrictEqual(JSON.parse(run(ctx, 'JSON.stringify(Store.get().groups[0].scenes.map(s => s.timerMode))')), ['compact', null]);
});

test('trocar vídeos: deteta a troca (e não confunde vídeos iguais nem substituições)', () => {
    const { ctx } = load(['media.js']);
    const swap = (p, n) => run(ctx, `Media.isSwap(${JSON.stringify(p)}, ${JSON.stringify(n)})`);
    assert.strictEqual(swap({ 1: 'A', 2: 'B' }, { 1: 'B', 2: 'A' }), true);
    assert.strictEqual(swap({ 1: 'A', 2: 'B' }, { 1: 'A', 2: 'B' }), false);
    assert.strictEqual(swap({ 1: 'A', 2: 'B' }, { 1: 'C', 2: 'A' }), false);     // substituição, não troca
    assert.strictEqual(swap({ 1: 'A', 2: 'A' }, { 1: 'A', 2: 'A' }), false);     // iguais: nada a trocar
    assert.strictEqual(swap({ 1: 'A', 2: null }, { 1: null, 2: 'A' }), false);   // só há um vídeo
});

test('pausa e ponto de cada posição seguem o vídeo na troca; vídeos iguais são independentes', () => {
    const { ctx } = load(['media.js']);
    run(ctx, `Media._ids = { 1: 'A', 2: 'B' }; Media._paused = { 1: true, 2: false }; Media._clock = { 1: 30, 2: 90 };`);
    run(ctx, `Media._followVideos({ 1: 'B', 2: 'A' })`);                            // troca
    assert.deepStrictEqual(JSON.parse(run(ctx, 'JSON.stringify([Media._paused, Media._clock])')),
        [{ 1: false, 2: true }, { 1: 90, 2: 30 }]);
    run(ctx, `Media._ids = { 1: 'B', 2: 'A' }; Media._followVideos({ 1: 'C', 2: 'A' })`);   // 1 substituído: recomeça
    assert.deepStrictEqual(JSON.parse(run(ctx, 'JSON.stringify([Media._paused, Media._clock])')),
        [{ 1: false, 2: true }, { 1: 0, 2: 30 }]);
    // o mesmo vídeo nos dois: pausar um não pausa o outro
    run(ctx, `Media._ids = { 1: 'A', 2: 'A' }; Media._want = { 1: {}, 2: {} }; Media._paused = { 1: false, 2: false };
              Media._push = () => {}; Media._publish = () => {}; Media.toggleVideo(1);`);
    assert.deepStrictEqual(JSON.parse(run(ctx, 'JSON.stringify(Media._paused)')), { 1: true, 2: false });
});

test('tamanho do texto: padrão "Grande", valores inválidos corrigem-se, e o subtexto cresce mais do que o título', () => {
    const { ctx } = load(base);
    run(ctx, 'Store.init()');
    assert.strictEqual(run(ctx, 'Store.get().textSize'), 'large');
    run(ctx, `Store.replace({ textSize: 'enorme-demais' })`);
    assert.strictEqual(run(ctx, 'Store.get().textSize'), 'large');
    run(ctx, `Store.replace({ textSize: 'huge' })`);                                // o nível antigo já não existe
    assert.strictEqual(run(ctx, 'Store.get().textSize'), 'large');
    run(ctx, `Store.replace({ textSize: 'medium' })`);
    assert.strictEqual(run(ctx, 'Store.get().textSize'), 'medium');
    assert.deepStrictEqual(run(ctx, 'Object.keys(Scenes.TEXT_SIZES).join()'), 'normal,medium,large,xlarge');
    const sizes = JSON.parse(run(ctx, 'JSON.stringify(Object.values(Scenes.TEXT_SIZES))'));
    for (let i = 1; i < sizes.length; i++) {
        assert.ok(sizes[i].title > sizes[i - 1].title && sizes[i].sub > sizes[i - 1].sub, 'níveis crescentes');
    }
    assert.ok(sizes.every(s => s.sub >= s.title), 'o subtexto nunca cresce menos do que o título');
    assert.deepStrictEqual([sizes[0].title, sizes[0].sub], [1, 1]);                  // "Normal" = aparência original
    assert.ok(run(ctx, `Scenes.contrast(Scenes.THEMES.contraste.bg, Scenes.THEMES.contraste.sub)`) >= 7);   // AAA para salas grandes
});

test('formatBytes', () => {
    const { ctx } = load(['utils.js']);
    const f = (v) => run(ctx, `Utils.formatBytes(${v})`);
    assert.strictEqual(f(0), '0 B');
    assert.strictEqual(f(900), '900 B');
    assert.strictEqual(f(1536), '1,5 KB');
    assert.strictEqual(f(8808038), '8,4 MB');
});

test('estado da galeria publicado pela TV (e só visível com a TV ligada)', () => {
    const { ctx } = load(['app-info.js', 'utils.js', 'sync.js']);
    assert.strictEqual(run(ctx, 'Sync.getGalleryState()'), null);
    run(ctx, `Sync._beat(); Sync.publishGalleryState({ index: 2, total: 9, playing: false });`);
    const g = JSON.parse(run(ctx, 'JSON.stringify(Sync.getGalleryState())'));
    assert.deepStrictEqual([g.index, g.total, g.playing], [2, 9, false]);
});

const imgCtx = () => load(['app-info.js', 'utils.js', 'images.js'], { indexedDB: fakeIndexedDB(), Blob });
const oldId = (ageMs, tail) => 'i' + (Date.now() - ageMs).toString(36).padStart(9, '0') + tail;

testAsync('Images: guardar, ler, listar, remover e limpar tudo', async () => {
    const { ctx } = imgCtx();
    await run(ctx, `Images._put({ id: 'ia', name: 'a.jpg', blob: new Blob(['aaa']), addedAt: 1 })`);
    await run(ctx, `Images._put({ id: 'ib', name: 'b.jpg', blob: new Blob(['bbb']), addedAt: 2 })`);
    assert.deepStrictEqual([...await run(ctx, 'Images.keys()')].sort(), ['ia', 'ib']);
    assert.strictEqual((await run(ctx, `Images.get('ia')`)).name, 'a.jpg');
    assert.strictEqual(await run(ctx, `Images.get('nao-existe')`), null);

    await run(ctx, `Images.remove(['ia'])`);
    assert.deepStrictEqual([...await run(ctx, 'Images.keys()')], ['ib']);
    await run(ctx, `Images.remove([])`);                          // sem ids: não bloqueia
    await run(ctx, 'Images.clear()');
    assert.strictEqual((await run(ctx, 'Images.keys()')).size, 0);
});

testAsync('Images: o id guarda a data de criação', async () => {
    const { ctx } = imgCtx();
    const id = run(ctx, 'Images._newId()');
    assert.ok(Math.abs(run(ctx, `Images._createdAt('${id}')`) - Date.now()) < 2000);
    assert.strictEqual(run(ctx, `Images._createdAt('i!!!')`), 0);
});

testAsync('Images.sweep: apaga órfãs antigas, poupa as que estão na lista e as recém-criadas', async () => {
    const { ctx } = imgCtx();
    const orphanOld = oldId(120000, 'aaaa'), listed = oldId(120000, 'bbbb'), fresh = oldId(1000, 'cccc');
    for (const id of [orphanOld, listed, fresh]) {
        await run(ctx, `Images._put({ id: '${id}', name: 'x', blob: new Blob(['x']), addedAt: 0 })`);
    }
    const removed = await run(ctx, `Images.sweep(['${listed}'])`);
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual([...await run(ctx, 'Images.keys()')].sort(), [fresh, listed].sort());
});

testAsync('Images.blobUrl: devolve URL para imagens existentes e null para as que faltam', async () => {
    const { ctx } = imgCtx();
    await run(ctx, `Images._put({ id: 'ia', name: 'a', blob: new Blob(['aaa']), addedAt: 0 })`);
    const url = await run(ctx, `Images.blobUrl('ia')`);
    assert.ok(String(url).startsWith('blob:'));
    assert.strictEqual(await run(ctx, `Images.blobUrl('ia')`), url);           // cache
    assert.strictEqual(await run(ctx, `Images.blobUrl('falta')`), null);
});

console.log('Sync');
test('comando entregue por 2 canais executa UMA vez (causa do bug do P)', () => {
    const { ctx } = load(['app-info.js', 'utils.js', 'sync.js']);
    run(ctx, `var calls = 0; Sync._onCommand = () => calls++;`);
    run(ctx, `var cmd = { id: 'c1', type: 'timer:toggle', payload: {}, ts: Date.now() };
              Sync._dispatch(JSON.stringify(cmd)); Sync._dispatch(cmd);`);
    assert.strictEqual(run(ctx, 'calls'), 1);
    run(ctx, `Sync._dispatch({ id: 'c2', type: 'x', ts: Date.now() - 99999 })`);
    assert.strictEqual(run(ctx, 'calls'), 1, 'comando expirado não deve correr');
    run(ctx, `Sync._dispatch({ id: 'c3', type: 'x', ts: Date.now() })`);
    assert.strictEqual(run(ctx, 'calls'), 2);
});

test('estado do alarme é publicado para o controlo', () => {
    const { ctx } = load(['app-info.js', 'utils.js', 'sync.js']);
    run(ctx, `Sync._beat(); Sync.publishTimerState({ remaining: 0, running: false, endsAt: null, alarm: true });`);
    assert.strictEqual(run(ctx, 'Sync.getTimerState().alarm'), true);
    run(ctx, `Sync.publishTimerState({ remaining: 60, running: false, endsAt: null, alarm: false });`);
    assert.strictEqual(run(ctx, 'Sync.getTimerState().alarm'), false);
});

test('estado do temporizador calculado pelo relógio quando a correr', () => {
    const { ctx } = load(['app-info.js', 'utils.js', 'sync.js']);
    run(ctx, `Sync._beat(); Sync.publishTimerState({ remaining: 100, running: true, endsAt: Date.now() + 30500 });`);
    const t = JSON.parse(run(ctx, 'JSON.stringify(Sync.getTimerState())'));
    assert.strictEqual(t.remaining, 31);
    assert.strictEqual(t.running, true);
    run(ctx, `localStorage.removeItem(Sync.KEY_HEARTBEAT)`);
    assert.strictEqual(run(ctx, 'Sync.getTimerState()'), null);
});

console.log('Timer');
test('contagem pelo relógio, aviso de 1 min e fim', () => {
    let now = 1_000_000;
    const ticks = [];
    const { ctx } = load(['timer.js'], {
        Date: { now: () => now },
        setInterval: (fn) => { ticks.push(fn); return ticks.length; },
        clearInterval() {}
    });
    run(ctx, `var log = { minute: 0, done: 0, last: null };
              Timer.init({ seconds: 70, onUpdate: t => log.last = t, onMinute: () => log.minute++, onComplete: () => log.done++ });
              Timer.start();`);
    const tick = () => ticks[ticks.length - 1]();
    now += 5000; tick();
    assert.strictEqual(run(ctx, 'log.last.remaining'), 65);
    now += 6000; tick();                                   // 59 s
    assert.strictEqual(run(ctx, 'log.minute'), 1);
    now += 5000; tick();
    assert.strictEqual(run(ctx, 'log.minute'), 1, 'aviso só uma vez');
    // pausar mantém o valor; "salto" no relógio (aba em segundo plano) é recuperado
    run(ctx, 'Timer.pause()');
    assert.strictEqual(run(ctx, 'Timer.remaining()'), 54);
    run(ctx, 'Timer.start()');
    now += 120_000; tick();
    assert.strictEqual(run(ctx, 'log.done'), 1);
    assert.strictEqual(run(ctx, 'Timer.isRunning()'), false);
    assert.strictEqual(run(ctx, 'log.last.remaining'), 0);
});

test('set() pára e redefine; startWith() arranca', () => {
    const { ctx } = load(['timer.js'], { Date: { now: () => 5 } });
    run(ctx, `Timer.init({ seconds: 60, onUpdate() {}, onMinute() {}, onComplete() {} }); Timer.start();`);
    assert.ok(run(ctx, 'Timer.isRunning()'));
    run(ctx, 'Timer.set(300)');
    assert.ok(!run(ctx, 'Timer.isRunning()'));
    assert.strictEqual(run(ctx, 'Timer.remaining()'), 300);
    run(ctx, 'Timer.startWith(10)');
    assert.ok(run(ctx, 'Timer.isRunning()'));
});

(async () => {
    console.log('Assíncronos');
    for (const [name, fn] of queue) { await fn(); n++; console.log('  ✓', name); }
    console.log(`\n${n} testes OK`);
})().catch((e) => { console.error(e); process.exit(1); });
