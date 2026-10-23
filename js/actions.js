/* =====================================================================
 * Actions — operações de cena partilhadas pela TV e pelo controlo
 *
 * Escrevem no Store (que notifica a outra janela). Como o estado é
 * partilhado, NÃO é preciso enviar comandos: a TV reage à mudança.
 * ===================================================================== */
const Actions = {

    goLive(sceneId) {
        return Store.update(d => Scenes.setLive(d, sceneId));
    },

    stepScene(delta) {
        return Store.update(d => Scenes.step(d, delta));
    },

    /** Pausa ⇄ cena anterior (tecla P e botão da TV). */
    toggleBreak() {
        let outcome;
        Store.update(d => (outcome = Scenes.toggleBreak(d)) === 'ok');

        if (outcome === 'noBreak') Notify.show('Este grupo não tem cena de pausa', 'WARNING');
        else if (outcome === 'noScene') Notify.show('Não há cena para onde voltar', 'WARNING');
    }
};
