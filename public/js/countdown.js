(function () {
  window.PP = window.PP || {};

  function formatMs(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function startCountdown(el, endsAt, { onDone, warnBelowMs = 20000 } = {}) {
    let done = false;
    function tick() {
      const remaining = endsAt - Date.now();
      el.textContent = formatMs(remaining);
      el.classList.toggle('is-warning', remaining > 0 && remaining <= warnBelowMs);
      if (remaining <= 0 && !done) {
        done = true;
        clearInterval(handle);
        onDone && onDone();
      }
    }
    tick();
    const handle = setInterval(tick, 200);
    return () => clearInterval(handle);
  }

  window.PP.startCountdown = startCountdown;
  window.PP.formatMs = formatMs;
})();
