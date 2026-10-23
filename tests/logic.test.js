/* Testes da lógica (sem browser):  node tests/logic.test.js */
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
    assert.strictEqual(P('5:60'), null);
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
    assert.ok(run(ctx, 'APP_INFO.credits').includes('Palco'));
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

console.log(`\n${n} testes OK`);
