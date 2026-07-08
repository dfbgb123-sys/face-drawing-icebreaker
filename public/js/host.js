(function () {
  const $ = (id) => document.getElementById(id);
  const views = ['setup', 'lobby', 'progress', 'results', 'ended'];
  function showView(name) {
    for (const v of views) $(`view-${v}`).style.display = v === name ? '' : 'none';
  }

  let socket = null;
  let stopTimer = null;

  function renderRoster(listEl, participants, { removable }) {
    listEl.innerHTML = '';
    for (const p of participants) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot' + (p.connected ? ' connected' : '');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const seat = document.createElement('span');
      seat.className = 'seat';
      seat.textContent = `#${p.seatIndex + 1}`;
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(seat);
      if (removable && !p.claimed) {
        const btn = document.createElement('button');
        btn.className = 'remove';
        btn.textContent = '제외';
        btn.addEventListener('click', () => {
          socket.emit('host:remove-participant', { participantId: p.id }, (res) => {
            if (!res || !res.ok) alert('제외하지 못했어요.');
          });
        });
        li.appendChild(btn);
      }
      listEl.appendChild(li);
    }
  }

  function connectSocket() {
    socket = io();

    socket.on('session:lobby-update', (data) => {
      renderRoster($('roster-list'), data.participants, { removable: true });
      renderRoster($('roster-list-progress'), data.participants, { removable: false });
      if (data.status === 'ended') showView('ended');
    });

    socket.on('session:intermission', ({ roundIndex, totalRounds, intermissionEndsAt }) => {
      showView('progress');
      $('round-label').textContent = `잠시 후 라운드 ${roundIndex + 1} / ${totalRounds} 시작`;
      $('submit-count').textContent = '';
      if (stopTimer) stopTimer();
      stopTimer = PP.startCountdown($('timer'), intermissionEndsAt);
    });

    socket.on('session:round-start', ({ roundIndex, totalRounds, roundEndsAt }) => {
      showView('progress');
      $('round-label').textContent = `라운드 ${roundIndex + 1} / ${totalRounds} 진행 중`;
      if (stopTimer) stopTimer();
      stopTimer = PP.startCountdown($('timer'), roundEndsAt);
    });

    socket.on('round:submission-progress', ({ submittedCount, totalExpected }) => {
      $('submit-count').textContent = `${submittedCount} / ${totalExpected}명 제출완료`;
    });

    socket.on('session:results-ready', () => {
      if (stopTimer) stopTimer();
      showView('results');
    });

    socket.on('session:participant-status', () => {
      // lobby-update already covers roster refresh in practice; kept for future fine-grained UI
    });
  }

  function hostJoinAndRender(sessionId) {
    socket.emit('host:join', {}, (res) => {
      if (!res || !res.ok) return;
      const snap = res.snapshot;
      renderRoster($('roster-list'), snap.participants, { removable: true });
      renderRoster($('roster-list-progress'), snap.participants, { removable: false });

      if (snap.status === 'lobby') {
        showView('lobby');
      } else if (snap.status === 'intermission') {
        showView('progress');
        $('round-label').textContent = `잠시 후 라운드 ${snap.currentRoundIndex + 1} / ${snap.totalRounds} 시작`;
        stopTimer = PP.startCountdown($('timer'), snap.intermissionEndsAt);
      } else if (snap.status === 'drawing') {
        showView('progress');
        $('round-label').textContent = `라운드 ${snap.currentRoundIndex + 1} / ${snap.totalRounds} 진행 중`;
        stopTimer = PP.startCountdown($('timer'), snap.roundEndsAt);
        if (snap.submissionProgress) {
          $('submit-count').textContent = `${snap.submissionProgress.submittedCount} / ${snap.submissionProgress.totalExpected}명 제출완료`;
        }
      } else if (snap.status === 'results') {
        showView('results');
      } else if (snap.status === 'ended') {
        showView('ended');
      }
    });
  }

  async function checkActiveSession() {
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (!data.session || data.session.status === 'ended') {
      showView('setup');
      return;
    }
    connectSocket();
    hostJoinAndRender(data.session.id);
  }

  $('create-btn').addEventListener('click', async () => {
    const names = $('names').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const minutes = parseFloat($('roundLength').value) || 3;
    $('setup-error').style.display = 'none';

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantNames: names, roundLengthMs: Math.round(minutes * 60 * 1000) })
      });
      const data = await res.json();
      if (!res.ok) {
        const messages = {
          TOO_FEW_PARTICIPANTS: '최소 3명 이상의 이름을 입력해주세요.',
          SESSION_ACTIVE: '이미 진행 중인 세션이 있어요. 페이지를 새로고침하면 이어서 진행할 수 있어요.',
          DUPLICATE_NAMES: `이름이 겹쳐요: ${(data.duplicates || []).join(', ')} — 서로 다른 이름으로 입력해주세요.`
        };
        $('setup-error').textContent = messages[data.code] || '세션을 만들지 못했어요.';
        $('setup-error').style.display = '';
        return;
      }
      $('qr-img').src = data.qrDataUrl;
      $('join-url').textContent = data.joinUrl;
      renderRoster($('roster-list'), data.participants, { removable: true });
      renderRoster($('roster-list-progress'), data.participants, { removable: false });
      showView('lobby');
      connectSocket();
      hostJoinAndRender(data.sessionId);
    } catch (err) {
      $('setup-error').textContent = '세션을 만들지 못했어요. 서버 연결을 확인해주세요.';
      $('setup-error').style.display = '';
    }
  });

  $('start-btn').addEventListener('click', () => {
    socket.emit('host:start-session', {}, (res) => {
      if (!res || !res.ok) {
        const messages = {
          TOO_FEW_PARTICIPANTS: '최소 3명이 필요해요.',
          ALREADY_STARTED: '이미 시작된 세션이에요.'
        };
        alert((res && messages[res.code]) || '시작하지 못했어요.');
      }
    });
  });

  $('force-advance-btn').addEventListener('click', () => {
    socket.emit('host:force-advance', {}, () => {});
  });

  function endSession() {
    if (!confirm('세션을 종료할까요? 되돌릴 수 없어요.')) return;
    socket.emit('host:end-session', {}, () => showView('ended'));
  }
  $('end-btn-lobby').addEventListener('click', endSession);
  $('end-btn-progress').addEventListener('click', endSession);
  $('end-btn-results').addEventListener('click', endSession);

  checkActiveSession();
})();
