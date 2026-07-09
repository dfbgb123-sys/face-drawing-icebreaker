(function () {
  const $ = (id) => document.getElementById(id);
  const views = ['setup', 'lobby', 'progress', 'results', 'ended'];
  function showView(name) {
    for (const v of views) $(`view-${v}`).style.display = v === name ? '' : 'none';
  }

  let socket = null;
  let stopTimer = null;
  let selectedMode = 'portrait';

  const modeMeta = {
    portrait: {
      label: '1:1 초상화',
      icon: '👩‍🤝‍👩',
      paragraph: '단 둘이서 정해진 시간 동안 서로의 얼굴을 마주 보고 그리는 가장 기본적인 초상화 모드입니다. 타이머가 끝나거나 먼저 저장 버튼을 누르면 내 세션이 종료되고, 상대방도 완료하면 결과 페이지에서 상대가 그린 나의 초상화를 확인할 수 있습니다. 둘만의 시간, 서로의 얼굴을 정면으로 담아보세요.',
      roundTip: '3~5분 권장',
      timeSubNote: ''
    },
    baton: {
      label: '바톤터치',
      icon: '🔄',
      paragraph: '내 얼굴을 그리는 것으로 시작해, 정해진 시간마다 캔버스가 다음 사람에게 넘어가며 나를 제외한 모든 참가자가 돌아가며 이어 그리는 협업 모드입니다. 그리는 중인 캔버스에는 항상 누구를 그리고 있는지 이름이 표시되고, 모든 순서가 끝나면 내가 처음 시작한 초상화가 다른 사람들의 손을 거쳐 완성된 채로 내게 돌아옵니다. 짧은 라운드일수록 더 재밌어지는 모드예요.',
      roundTip: '1~2분 권장',
      timeSubNote: '라운드를 짧게 잡을수록 전체 진행이 빨라져요'
    },
    multi: {
      label: '1:多 초상화',
      icon: '🖼️',
      paragraph: '나를 제외한 모든 참가자를 한 명씩 돌아가며 그리는 모드로, 참가자 수만큼 라운드가 진행됩니다. 다양한 사람의 시선으로 그려진 내 초상화를 한 번에 여러 장 받아볼 수 있다는 게 매력이지만, 인원이 많아질수록 소요 시간이 길어지고 후반부로 갈수록 지칠 수 있어 3~5명 정도의 인원을 추천합니다.',
      roundTip: '3~5분 권장',
      timeSubNote: '인원이 많을수록 소요시간이 길어져요'
    }
  };

  function updateSelectedModeDisplay() {
    const meta = modeMeta[selectedMode];
    const lobbyModeLabel = $('session-mode');
    if (lobbyModeLabel) lobbyModeLabel.textContent = `선택된 모드: ${meta.label}`;

    const visual = $('mode-visual');
    if (visual) visual.dataset.mode = selectedMode;
    const visualIcon = $('mode-visual-icon');
    if (visualIcon) visualIcon.textContent = meta.icon;
    const paragraph = $('mode-paragraph');
    if (paragraph) paragraph.textContent = meta.paragraph;
    const roundTip = $('round-tip');
    if (roundTip) roundTip.innerHTML = meta.roundTip;
  }

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

    socket.on('session:reveal-wait', ({ revealEndsAt }) => {
      showView('progress');
      $('round-label').textContent = '두구두구 🥁 결과를 준비하고 있어요';
      $('submit-count').textContent = '';
      if (stopTimer) stopTimer();
      stopTimer = PP.startCountdown($('timer'), revealEndsAt);
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
      } else if (snap.status === 'reveal-wait') {
        showView('progress');
        $('round-label').textContent = '두구두구 🥁 결과를 준비하고 있어요';
        stopTimer = PP.startCountdown($('timer'), snap.revealEndsAt);
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
    selectedMode = data.session.mode || 'portrait';
    modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === selectedMode));
    updateSelectedModeDisplay();
    connectSocket();
    hostJoinAndRender(data.session.id);
  }

  function updateRoundEstimate(participantCount) {
    const roundsEl = $('round-estimate-rounds');
    const timeEl = $('round-estimate-time');
    if (!roundsEl || !timeEl) return;
    const timeSubNote = modeMeta[selectedMode].timeSubNote;
    const timeSubHtml = timeSubNote ? `<span class="hint-sub time-sub-note">${timeSubNote}</span>` : '';
    if (selectedMode === 'portrait') {
      roundsEl.innerHTML = '예상 라운드 : <span class="estimate-value">1회</span>';
      const minutes = parseFloat($('roundLength').value) || 0;
      timeEl.innerHTML = `총 소요시간 : <span class="estimate-value">약 ${minutes}분</span>${timeSubHtml}`;
      return;
    }
    if (participantCount < 2) {
      roundsEl.innerHTML = '예상 라운드 : <span class="hint-sub">참가자 2명 이상 입력하면 계산돼요.</span>';
      timeEl.innerHTML = `총 소요시간 :${timeSubHtml}`;
      return;
    }
    const rounds = selectedMode === 'baton' ? participantCount : participantCount - 1;
    const minutes = parseFloat($('roundLength').value) || 0;
    const totalMinutes = Math.round(rounds * minutes * 10) / 10;
    roundsEl.innerHTML = `예상 라운드 : <span class="estimate-value">${rounds}회</span>`;
    timeEl.innerHTML = `총 소요시간 : <span class="estimate-value">약 ${totalMinutes}분</span>${timeSubHtml}`;
  }

  function updateParticipantCount() {
    const names = $('names').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const countEl = $('participant-count');
    const hintEl = $('participant-hint');
    countEl.textContent = `참가자 ${names.length}명`;
    if (selectedMode === 'portrait') {
      hintEl.textContent = '정확히 2명 필요';
      countEl.classList.toggle('is-invalid', names.length !== 2);
    } else if (selectedMode === 'baton') {
      hintEl.textContent = '2~15명 가능';
      countEl.classList.remove('is-invalid');
    } else {
      hintEl.textContent = '';
      countEl.classList.remove('is-invalid');
    }
    updateRoundEstimate(names.length);
  }

  let toastTimeout = null;
  function showToast(message) {
    const toastEl = $('toast');
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  const PARTICIPANT_LIMITS = {
    portrait: { cap: 2, message: '1:1 모드에서는 참가자가 2명으로 제한돼요.' },
    baton: { cap: 15, message: '바톤터치는 최대 15명까지 가능해요.' },
    multi: {}
  };

  let participantLimitWarned = false;
  function enforceParticipantLimit() {
    const limit = PARTICIPANT_LIMITS[selectedMode] || {};
    if (!limit.cap) {
      participantLimitWarned = false;
      return;
    }
    const textarea = $('names');
    const rawLines = textarea.value.split('\n');
    const nonEmptyIdx = [];
    rawLines.forEach((line, i) => {
      if (line.trim() !== '') nonEmptyIdx.push(i);
    });
    if (nonEmptyIdx.length <= limit.cap) {
      participantLimitWarned = false;
      return;
    }
    const keepUntil = nonEmptyIdx[limit.cap - 1];
    textarea.value = rawLines.slice(0, keepUntil + 1).join('\n');
    if (!participantLimitWarned) {
      showToast(limit.message);
      participantLimitWarned = true;
    }
  }

  $('names').addEventListener('input', () => {
    enforceParticipantLimit();
    updateParticipantCount();
  });
  $('roundLength').addEventListener('input', updateParticipantCount);
  updateParticipantCount();

  const guideModal = $('guide-modal');
  $('guide-btn').addEventListener('click', () => { guideModal.hidden = false; });
  $('guide-close').addEventListener('click', () => { guideModal.hidden = true; });
  guideModal.addEventListener('click', (e) => {
    if (e.target === guideModal) guideModal.hidden = true;
  });

  const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedMode = button.dataset.mode || 'portrait';
      modeButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      updateSelectedModeDisplay();
      enforceParticipantLimit();
      updateParticipantCount();
    });
  });
  updateSelectedModeDisplay();

  $('create-btn').addEventListener('click', async () => {
    const names = $('names').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const minutes = parseFloat($('roundLength').value) || 3;
    $('setup-error').style.display = 'none';

    if (selectedMode === 'portrait' && names.length !== 2) {
      $('setup-error').textContent = '1:1 모드는 참가자가 정확히 2명이어야 해요.';
      $('setup-error').style.display = '';
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantNames: names,
          roundLengthMs: Math.round(minutes * 60 * 1000),
          mode: selectedMode
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const messages = {
          TOO_FEW_PARTICIPANTS: '최소 2명 이상의 이름을 입력해주세요.',
          PORTRAIT_REQUIRES_TWO: '1:1 모드는 참가자가 정확히 2명이어야 해요.',
          BATON_TOO_MANY_PARTICIPANTS: '바톤터치는 최대 15명까지 가능해요.',
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
