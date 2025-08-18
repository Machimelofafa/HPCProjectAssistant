export function InteractionManager(svg, options = {}) {
    const Z = {};
    let vb = [0, 0, svg.clientWidth || 800, svg.clientHeight || 500];
    const listeners = [];

    function setVB(x, y, w, h) {
        vb = [x, y, w, h];
        svg.setAttribute('viewBox', vb.join(' '));
        listeners.forEach(fn => fn(vb));
    }

    function fit() {
        const w = svg.clientWidth || 800;
        const h = svg.clientHeight || 500;
        if (options.fitContent) {
            try {
                const bbox = svg.getBBox();
                if (bbox.width > 0 && bbox.height > 0) {
                    const padding = 20;
                    setVB(bbox.x - padding, bbox.y - padding, bbox.width + padding * 2, bbox.height + padding * 2);
                    return;
                }
            } catch (e) { /* initial render might fail */ }
        }
        setVB(0, 0, w, h);
    }
    fit();

    let dragging = false;
    let p0 = null;

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();

        if (e.ctrlKey) { // ZOOM
            const scale = e.deltaY > 0 ? 1.1 : 0.9;
            const mx = e.offsetX;
            const my = e.offsetY;
            const clientWidth = svg.clientWidth || 1;
            const clientHeight = svg.clientHeight || 1;

            const pointX = vb[0] + mx * (vb[2] / clientWidth);
            const pointY = vb[1] + my * (vb[3] / clientHeight);

            const newW = vb[2] * scale;
            const newH = vb[3] * scale;

            const newX = pointX - mx * (newW / clientWidth);
            const newY = pointY - my * (newH / clientHeight);

            setVB(newX, newY, newW, newH);
        } else { // PAN
            const clientWidth = svg.clientWidth || 1;
            const clientHeight = svg.clientHeight || 1;
            const panXAmount = (e.shiftKey ? e.deltaY : e.deltaX) * (vb[2] / clientWidth);
            const panYAmount = (e.shiftKey ? 0 : e.deltaY) * (vb[3] / clientHeight);
            setVB(vb[0] + panXAmount, vb[1] + panYAmount, vb[2], vb[3]);
        }
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target !== svg) return;
        dragging = true;
        p0 = { x: e.clientX, y: e.clientY, vb0: [...vb] };
        svg.setPointerCapture(e.pointerId);
        svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const clientWidth = svg.clientWidth || 1;
        const clientHeight = svg.clientHeight || 1;
        const dx = (e.clientX - p0.x) * (vb[2] / clientWidth);
        const dy = (e.clientY - p0.y) * (vb[3] / clientHeight);
        setVB(p0.vb0[0] - dx, p0.vb0[1] - dy, vb[2], vb[3]);
    });

    svg.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        svg.releasePointerCapture(e.pointerId);
        svg.style.cursor = 'grab';
    });

    svg.style.cursor = 'grab';

    Z.zoomIn = () => {
        const scale = 0.9;
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        setVB(vb[0] + (vb[2] - newW) / 2, vb[1] + (vb[3] - newH) / 2, newW, newH);
    };
    Z.zoomOut = () => {
        const scale = 1.1;
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        setVB(vb[0] - (newW - vb[2]) / 2, vb[1] - (newH - vb[3]) / 2, newW, newH);
    };
    Z.fit = fit;
    Z.getViewBox = () => vb.slice();
    Z.setViewBox = (x, y, w, h) => setVB(x, y, w, h);
    Z.onChange = (fn) => { listeners.push(fn); };

    return Z;
}
