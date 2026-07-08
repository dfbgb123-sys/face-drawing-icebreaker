(function () {
  const $ = (id) => document.getElementById(id);
  const views = ['loading', 'none', 'join', 'lobby', 'intermission', 'drawing', 'results', 'ended'];
  let currentView = 'loading';
  function showView(name) {
    currentView = name;
    for (const v of views) $(`view-${v}`).style.display = v === name ? '' : 'none';
  }

  const CANVAS_W = 800;
  const CANVAS_H = 600;

  let socket = null;
  let sessionId = null;
  const me = { participantId: null, clientToken: null, name: null };
  let allParticipants = [];
  let pendingAssignment = null;
  let submittedThisRound = false;
  let pad = null;
  let stopTimer = null;
  let portraits = [];
  let portraitIndex = 0;
  const guessState = new Map();

  function ensurePad() {
    if (pad) return;
    pad = PP.createDrawingPad($('pad'), { width: CANVAS_W, height: CANVAS_H });
  }

  function updateSubmittedUI() {
    $('submitted-banner').style.display = submittedThisRound ? '' : 'none';
    $('submit-btn').disabled = submittedThisRound;
    $('clear-btn').disabled = submittedThisRound;
    $('pad').style.pointerEvents = submittedThisRound ? 'none' : 'auto';
  }

  function doSubmit() {
    if (submittedThisRound || !pendingAssignment) return;
    const assignment = pendingAssignment;
    submittedThisRound = true;
    updateSubmittedUI();
    pad.toBlob().then((blob) => {
      const url = `/api/sessions/${sessionId}/drawings?participantId=${encodeURIComponent(
        me.participantId
      )}&clientToken=${encodeURIComponent(me.clientToken)}&roundIndex=${assignment.roundIndex}`;
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }).catch(() => {});
    });
  }

  function showLobby() {
    $('lobby-greeting').textContent = me.name ? `${me.name}님, 환영해요!` : '환영해요!';
    showView('lobby');
  }

  function showIntermission(intermissionEndsAt) {
    showView('intermission');
    $('intermission-subject').textContent = pendingAssignment ? `${pendingAssignment.subjectName}님` : '...';
    if (stopTimer) stopTimer();
    stopTimer = PP.startCountdown($('intermission-timer'), intermissionEndsAt);
  }

  function showDrawing(roundIndex, totalRounds, roundEndsAt, assignment) {
    pendingAssignment = assignment;
    submittedThisRound = assignment ? Boolean(assignment.alreadySubmitted) : false;
    showView('drawing');
    $('drawing-round-label').textContent = `라운드 ${roundIndex + 1} / ${totalRounds}`;
    $('drawing-subject-name').textContent = assignment ? `${assignment.subjectName}님을 그려주세요` : '';

    ensurePad();
    if (!submittedThisRound) pad.clear();
    updateSubmittedUI();

    if (stopTimer) stopTimer();
    stopTimer = PP.startCountdown($('drawing-timer'), roundEndsAt, {
      onDone: () => doSubmit()
    });
  }

  function renderPortrait() {
    const total = portraits.length;
    $('portrait-position').textContent = total ? `${portraitIndex + 1} / ${total}` : '0 / 0';
    const card = $('portrait-card');
    if (total === 0) {
      card.innerHTML = '<p class="muted" style="text-align:center;">받은 그림이 없어요.</p>';
      $('guess-panel').style.display = 'none';
      return;
    }
    $('guess-panel').style.display = '';
    const p = portraits[portraitIndex];
    if (p.missing) {
      card.innerHTML = '<div class="portrait-missing">이 라운드에는 그림을 받지 못했어요.</div>';
    } else {
      card.innerHTML = `<img src="${p.pngUrl}" alt="내 초상화" /><a class="download-link" href="${p.pngUrl}" download>PNG로 저장</a>`;
    }
    renderGuessPanel(p);
  }

  function renderRevealResult(state) {
    const box = $('reveal-result');
    box.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'reveal-result ' + (state.correct ? 'correct' : 'wrong');
    div.textContent = state.correct
      ? `정답이에요! ${state.actualArtistName}님이 그렸어요.`
      : `아쉬워요, 실제로는 ${state.actualArtistName}님이 그렸어요.`;
    box.appendChild(div);
  }

  function renderGuessPanel(portrait) {
    const state = guessState.get(portrait.roundIndex) || {};
    const grid = $('guess-grid');
    grid.innerHTML = '';
    const options = allParticipants.filter((p) => p.id !== me.participantId);
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'guess-option' + (state.guessedArtistId === opt.id ? ' selected' : '');
      btn.textContent = opt.name;
      btn.disabled = Boolean(state.revealed);
      btn.addEventListener('click', () => {
        state.guessedArtistId = opt.id;
        guessState.set(portrait.roundIndex, state);
        socket.emit('player:submit-guess', { roundIndex: portrait.roundIndex, guessedArtistId: opt.id }, () => {});
        renderGuessPanel(portrait);
      });
      grid.appendChild(btn);
    }
    $('reveal-btn').disabled = Boolean(state.revealed) || portrait.missing;
    $('reveal-result').innerHTML = '';
    if (state.revealed) renderRevealResult(state);
  }

  function showResults() {
    portraitIndex = 0;
    showView('results');
    $('results-intro').textContent = `총 ${portraits.length}장을 확인할 수 있어요.`;
    renderPortrait();
  }

  function applySnapshot(snap) {
    if (snap.status === 'lobby') {
      showLobby();
    } else if (snap.status === 'intermission') {
      pendingAssignment = snap.currentAssignment || null;
      showIntermission(snap.intermissionEndsAt);
    } else if (snap.status === 'drawing') {
      showDrawing(snap.currentRoundIndex, snap.totalRounds, snap.roundEndsAt, snap.currentAssignment);
    } else if (snap.status === 'results') {
      portraits = snap.portraits || [];
      showResults();
    } else {
      showView('ended');
    }
  }

  function renderNameGrid(participants) {
    const grid = $('name-grid');
    grid.innerHTML = '';
    for (const p of participants) {
      const btn = document.createElement('button');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      btn.appendChild(nameSpan);
      if (p.claimed) {
        const takenSpan = document.createElement('span');
        takenSpan.className = 'taken-label';
        takenSpan.textContent = '입장함';
        btn.appendChild(takenSpan);
      }
      btn.disabled = p.claimed;
      btn.addEventListener('click', () => joinAsParticipant(p.id, p.name));
      grid.appendChild(btn);
    }
  }

  function joinAsParticipant(participantId, name) {
    socket.emit('player:join', { participantId }, (res) => {
      if (!res || !res.ok) {
        const messages = {
          NAME_TAKEN: '다른 사람이 이미 선택한 이름이에요.',
          NO_LOBBY: '이미 시작됐거나 세션이 없어요.'
        };
        alert((res && messages[res.code]) || '입장하지 못했어요.');
        loadJoinScreen();
        return;
      }
      me.participantId = participantId;
      me.clientToken = res.clientToken;
      me.name = name;
      PP.identity.save({ sessionId, participantId, clientToken: res.clientToken });
      applySnapshot(res.snapshot);
    });
  }

  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('session:lobby-update', (data) => {
      allParticipants = data.participants;
      if (!me.name && me.participantId) {
        const mine = allParticipants.find((p) => p.id === me.participantId);
        if (mine) me.name = mine.name;
      }
      if (currentView === 'join') renderNameGrid(data.participants);
      if (data.status === 'ended') showView('ended');
    });

    socket.on('round:assignment', ({ roundIndex, subjectId, subjectName }) => {
      pendingAssignment = { roundIndex, subjectId, subjectName };
    });

    socket.on('session:intermission', ({ intermissionEndsAt }) => {
      showIntermission(intermissionEndsAt);
    });

    socket.on('session:round-start', ({ roundIndex, totalRounds, roundEndsAt }) => {
      showDrawing(roundIndex, totalRounds, roundEndsAt, pendingAssignment);
    });

    socket.on('round:end', () => {
      submittedThisRound = true;
      updateSubmittedUI();
    });

    socket.on('session:results-ready', () => {
      if (stopTimer) stopTimer();
    });

    socket.on('results:your-portraits', (data) => {
      portraits = data.portraits || [];
      showResults();
    });
  }

  async function loadJoinScreen() {
    showView('loading');
    const res = await fetch('/api/sessions/active');
    const data = await res.json();
    if (!data.session || data.session.status === 'ended') {
      showView('none');
      return;
    }
    if (data.session.status !== 'lobby') {
      showView('none');
      $('view-none').querySelector('h2').textContent = '이미 게임이 진행 중이에요';
      $('view-none').querySelector('p').textContent = '이번 게임이 끝날 때까지 기다려주세요.';
      return;
    }
    sessionId = data.session.id;
    allParticipants = data.session.participants;
    renderNameGrid(allParticipants);
    showView('join');
    connectSocket();
  }

  async function init() {
    showView('loading');
    const identity = PP.identity.load();
    if (!identity) {
      loadJoinScreen();
      return;
    }
    sessionId = identity.sessionId;
    me.participantId = identity.participantId;
    me.clientToken = identity.clientToken;
    connectSocket();
    socket.emit('player:rejoin', identity, (res) => {
      if (!res || !res.ok) {
        PP.identity.clear();
        me.participantId = null;
        me.clientToken = null;
        loadJoinScreen();
        return;
      }
      applySnapshot(res.snapshot);
    });
  }

  document.querySelectorAll('.swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (pad) {
        pad.setColor(btn.dataset.color);
        pad.setTool('pen');
      }
      $('pen-btn').classList.add('active');
      $('eraser-btn').classList.remove('active');
    });
  });
  $('pen-btn').addEventListener('click', () => {
    if (pad) pad.setTool('pen');
    $('pen-btn').classList.add('active');
    $('eraser-btn').classList.remove('active');
  });
  $('eraser-btn').addEventListener('click', () => {
    if (pad) pad.setTool('eraser');
    $('eraser-btn').classList.add('active');
    $('pen-btn').classList.remove('active');
  });
  $('clear-btn').addEventListener('click', () => {
    if (pad && !submittedThisRound) pad.clear();
  });
  $('submit-btn').addEventListener('click', doSubmit);
  $('retry-btn').addEventListener('click', loadJoinScreen);
  $('prev-btn').addEventListener('click', () => {
    if (!portraits.length) return;
    portraitIndex = (portraitIndex - 1 + portraits.length) % portraits.length;
    renderPortrait();
  });
  $('next-btn').addEventListener('click', () => {
    if (!portraits.length) return;
    portraitIndex = (portraitIndex + 1) % portraits.length;
    renderPortrait();
  });
  $('reveal-btn').addEventListener('click', () => {
    const p = portraits[portraitIndex];
    if (!p || p.missing) return;
    socket.emit('player:request-reveal', { roundIndex: p.roundIndex }, (res) => {
      if (!res || !res.ok) return;
      const state = guessState.get(p.roundIndex) || {};
      state.revealed = true;
      state.actualArtistId = res.actualArtistId;
      state.actualArtistName = res.actualArtistName;
      state.correct = res.correct;
      guessState.set(p.roundIndex, state);
      renderGuessPanel(p);
    });
  });

  init();
})();
