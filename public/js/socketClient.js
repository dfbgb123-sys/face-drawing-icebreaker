(function () {
  window.PP = window.PP || {};
  const KEY = 'portraitParty:identity';

  function saveIdentity({ sessionId, participantId, clientToken }) {
    localStorage.setItem(KEY, JSON.stringify({ sessionId, participantId, clientToken }));
  }

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearIdentity() {
    localStorage.removeItem(KEY);
  }

  window.PP.identity = { save: saveIdentity, load: loadIdentity, clear: clearIdentity };
})();
