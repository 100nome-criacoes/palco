/* =====================================================================
 * APP_INFO — identidade da aplicação (nome, versão, autor, prefixo interno)
 *
 * É o ÚNICO sítio a editar para renomear/versionar a app.
 *
 * Atenção ao `slug`: dá o prefixo às chaves do localStorage, canais e janelas.
 * Se o mudares, os dados guardados deixam de ser encontrados — exporta antes
 * (Controlo → Sistema → Exportar) e importa depois.
 * ===================================================================== */
const APP_INFO = {
    name: 'Palco',
    tagline: 'Auxiliar de sessão para formadores',
    slug: 'palco',
    author: 'João Frade',
    version: 'v2.1-f1',
    codename: 'Quadro',
    license: 'MIT',
    repo: 'https://github.com/100nome-criacoes/palco',

    /** "Palco v2.0-f1" (rodapé da TV) */
    get short() { return `${this.name} ${this.version}`; },
    get issuesUrl() { return `${this.repo}/issues`; },
    get licenseUrl() { return `${this.repo}/blob/HEAD/LICENSE`; },

    /** Chave interna com o prefixo da app: key('cmd') → "palco_cmd" */
    key(name) { return `${this.slug}_${name}`; }
};
