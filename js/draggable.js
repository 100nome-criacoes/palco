/* =====================================================================
 * Draggable — arrastar um elemento por uma pega (rato e toque)
 * ===================================================================== */
const Draggable = {

    /**
     * @param {HTMLElement} handle  elemento que se agarra
     * @param {HTMLElement} target  elemento que se move
     * @param {object} opts
     *   canDrag()      → false para impedir o arrastar
     *   onMove({x,y})  → posição (canto sup. esquerdo) durante o arrastar
     *   onEnd({x,y})   → posição final
     */
    attach(handle, target, { canDrag, onMove, onEnd }) {
        let drag = null;

        handle.addEventListener('pointerdown', (e) => {
            if (canDrag && !canDrag()) return;
            const rect = target.getBoundingClientRect();
            drag = { startX: e.clientX, startY: e.clientY, x: rect.left, y: rect.top, origin: rect };
            handle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        handle.addEventListener('pointermove', (e) => {
            if (!drag) return;
            drag.x = drag.origin.left + (e.clientX - drag.startX);
            drag.y = drag.origin.top + (e.clientY - drag.startY);
            drag.moved = true;
            if (onMove) onMove({ x: drag.x, y: drag.y });
        });

        const finish = (e) => {
            if (!drag) return;
            const result = { x: drag.x, y: drag.y };
            const moved = drag.moved;
            drag = null;
            try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
            if (moved && onEnd) onEnd(result);   // um simples clique não reposiciona
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
    }
};
