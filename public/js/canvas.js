(function () {
  window.PP = window.PP || {};

  function createDrawingPad(canvasEl, { width, height }) {
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let color = '#232320';
    let lineWidth = 6;
    let tool = 'pen';
    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    function fillWhite() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    fillWhite();

    function posFromEvent(e) {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function dot(x, y) {
      ctx.beginPath();
      ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.arc(x, y, (tool === 'eraser' ? lineWidth * 3 : lineWidth) / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    function pointerDown(e) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      drawing = true;
      const p = posFromEvent(e);
      lastX = p.x;
      lastY = p.y;
      canvasEl.setPointerCapture(e.pointerId);
      dot(p.x, p.y);
    }

    function pointerMove(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = posFromEvent(e);
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth = tool === 'eraser' ? lineWidth * 3 : lineWidth;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x;
      lastY = p.y;
    }

    function pointerUp() {
      drawing = false;
    }

    canvasEl.addEventListener('pointerdown', pointerDown);
    canvasEl.addEventListener('pointermove', pointerMove);
    canvasEl.addEventListener('pointerup', pointerUp);
    canvasEl.addEventListener('pointercancel', pointerUp);
    canvasEl.addEventListener('pointerleave', pointerUp);
    canvasEl.style.touchAction = 'none';

    function loadBackground(url) {
      return new Promise((resolve) => {
        if (!url) {
          fillWhite();
          resolve();
          return;
        }
        const img = new Image();
        img.onload = () => {
          fillWhite();
          ctx.drawImage(img, 0, 0, width, height);
          resolve();
        };
        img.onerror = () => {
          fillWhite();
          resolve();
        };
        img.src = url;
      });
    }

    return {
      clear: fillWhite,
      loadBackground,
      setColor(c) { color = c; },
      setWidth(w) { lineWidth = w; },
      setTool(t) { tool = t; },
      toBlob() {
        return new Promise((resolve) => canvasEl.toBlob(resolve, 'image/png'));
      }
    };
  }

  window.PP.createDrawingPad = createDrawingPad;
})();
