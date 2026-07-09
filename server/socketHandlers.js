const sessionStore = require('./sessionStore');
const roundEngine = require('./roundEngine');
const config = require('./config');
const drawingStorage = require('./drawingStorage');
const { getArtistForSubjectInRound } = require('./assignment');

function publicParticipant(p) {
  return { id: p.id, name: p.name, seatIndex: p.seatIndex, claimed: p.claimed, connected: p.connected };
}

function buildPlayerSnapshot(session, participant) {
  const base = {
    status: session.status,
    mode: session.mode,
    roundLengthMs: session.roundLengthMs,
    totalRounds: session.totalRounds,
    currentRoundIndex: session.currentRoundIndex,
    roundEndsAt: session.roundEndsAt,
    intermissionEndsAt: session.intermissionEndsAt,
    revealEndsAt: session.revealEndsAt
  };

  if (session.status === 'drawing' || session.status === 'intermission') {
    const assignment = roundEngine
      .currentAssignments(session)
      .find((a) => a.artistId === participant.id);
    const subject = assignment && sessionStore.findParticipantById(session, assignment.subjectId);
    base.currentAssignment = assignment
      ? {
          roundIndex: session.currentRoundIndex,
          subjectId: assignment.subjectId,
          subjectName: subject.name,
          alreadySubmitted: session.submissions.has(
            roundEngine.submissionKey(session.currentRoundIndex, participant.id)
          ),
          ...(session.mode === 'baton' && session.currentRoundIndex > 0
            ? { canvasUrl: `${drawingStorage.batonPngUrlFor(session, subject.name)}?r=${session.currentRoundIndex}` }
            : {})
        }
      : null;
  }

  if (session.status === 'results') {
    if (session.mode === 'baton') {
      base.portraits = roundEngine.getBatonGallery(session, participant.id);
    } else {
      base.portraits = roundEngine.getPortraitsForParticipant(session, participant.id);
      if (session.mode === 'portrait') {
        base.myDrawing = roundEngine.getArtistDrawing(session, participant.id);
      }
    }
  }

  return base;
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('player:join', ({ participantId } = {}, ack) => {
      const session = sessionStore.getActiveSession();
      if (!session || session.status !== 'lobby') {
        return ack && ack({ ok: false, code: 'NO_LOBBY' });
      }
      const participant = sessionStore.findParticipantById(session, participantId);
      if (!participant) return ack && ack({ ok: false, code: 'UNKNOWN_PARTICIPANT' });
      if (participant.claimed) return ack && ack({ ok: false, code: 'NAME_TAKEN' });

      sessionStore.claimParticipant(session, participantId, socket.id);
      socket.data.sessionId = session.id;
      socket.data.participantId = participantId;
      socket.join(roundEngine.sessionRoom(session.id));

      roundEngine.emitLobbyUpdate(session, io);
      ack && ack({ ok: true, clientToken: participant.clientToken, snapshot: buildPlayerSnapshot(session, participant) });
    });

    socket.on('player:rejoin', ({ participantId, clientToken } = {}, ack) => {
      const session = sessionStore.getActiveSession();
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      const participant = sessionStore.reconnectParticipant(session, participantId, clientToken, socket.id);
      if (!participant) return ack && ack({ ok: false, code: 'INVALID_TOKEN' });

      socket.data.sessionId = session.id;
      socket.data.participantId = participantId;
      socket.join(roundEngine.sessionRoom(session.id));

      roundEngine.emitLobbyUpdate(session, io);
      io.to(roundEngine.sessionRoom(session.id)).emit('session:participant-status', {
        participantId,
        connected: true
      });
      ack && ack({ ok: true, snapshot: buildPlayerSnapshot(session, participant) });
    });

    socket.on('player:submit-guess', ({ roundIndex, guessedArtistId } = {}, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session || session.status !== 'results') return ack && ack({ ok: false, code: 'NOT_RESULTS' });
      const key = `${roundIndex}:${socket.data.participantId}`;
      session.guesses.set(key, {
        roundIndex,
        subjectId: socket.data.participantId,
        guessedArtistId,
        guessedAt: Date.now(),
        revealed: false
      });
      ack && ack({ ok: true });
    });

    socket.on('player:request-reveal', ({ roundIndex } = {}, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session || session.status !== 'results') return ack && ack({ ok: false, code: 'NOT_RESULTS' });

      const subject = sessionStore.findParticipantById(session, socket.data.participantId);
      const n = session.participants.length;
      const artistSeat = getArtistForSubjectInRound(subject.seatIndex, roundIndex, session.offsets, n);
      const artist = session.participants[artistSeat];

      const key = `${roundIndex}:${socket.data.participantId}`;
      const guess = session.guesses.get(key);
      if (guess) guess.revealed = true;

      ack &&
        ack({
          ok: true,
          actualArtistId: artist.id,
          actualArtistName: artist.name,
          correct: Boolean(guess && guess.guessedArtistId === artist.id)
        });
    });

    socket.on('player:leave', (_payload, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (session && socket.data.participantId) {
        sessionStore.setParticipantConnected(session, socket.data.participantId, false);
        const p = sessionStore.findParticipantById(session, socket.data.participantId);
        if (p) p.claimed = false;
        roundEngine.emitLobbyUpdate(session, io);
      }
      ack && ack({ ok: true });
    });

    socket.on('host:join', (_payload, ack) => {
      const session = sessionStore.getActiveSession();
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      session.hostSocketId = socket.id;
      socket.data.sessionId = session.id;
      socket.data.isHost = true;
      socket.join(roundEngine.sessionRoom(session.id));
      ack &&
        ack({
          ok: true,
          snapshot: {
            status: session.status,
            mode: session.mode,
            roundLengthMs: session.roundLengthMs,
            totalRounds: session.totalRounds,
            currentRoundIndex: session.currentRoundIndex,
            roundEndsAt: session.roundEndsAt,
            intermissionEndsAt: session.intermissionEndsAt,
            revealEndsAt: session.revealEndsAt,
            participants: session.participants.map(publicParticipant),
            submissionProgress:
              session.status === 'drawing' ? roundEngine.getSubmissionProgress(session) : null
          }
        });
    });

    socket.on('host:remove-participant', ({ participantId } = {}, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      const removed = sessionStore.removeParticipant(session, participantId);
      if (removed) roundEngine.emitLobbyUpdate(session, io);
      ack && ack({ ok: removed });
    });

    socket.on('host:start-session', (_payload, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      if (session.status !== 'lobby') return ack && ack({ ok: false, code: 'ALREADY_STARTED' });
      if (session.participants.length < config.MIN_PARTICIPANTS) {
        return ack && ack({ ok: false, code: 'TOO_FEW_PARTICIPANTS' });
      }
      roundEngine.startSession(session, io);
      ack && ack({ ok: true });
    });

    socket.on('host:force-advance', (_payload, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      ack && ack(roundEngine.forceAdvance(session, io));
    });

    socket.on('host:end-session', (_payload, ack) => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session) return ack && ack({ ok: false, code: 'NO_SESSION' });
      clearTimeout(session.roundTimerHandle);
      clearTimeout(session.intermissionTimerHandle);
      clearTimeout(session.revealTimerHandle);
      session.status = 'ended';
      drawingStorage.finalizeSessionFolder(session).catch((err) => console.error('세션 폴더 정리 실패:', err));
      io.to(roundEngine.sessionRoom(session.id)).emit('session:lobby-update', {
        status: 'ended',
        roundLengthMs: session.roundLengthMs,
        participants: session.participants.map(publicParticipant)
      });
      ack && ack({ ok: true });
    });

    socket.on('disconnect', () => {
      const session = sessionStore.getSession(socket.data.sessionId);
      if (!session || !socket.data.participantId) return;
      const participant = sessionStore.findParticipantById(session, socket.data.participantId);
      if (participant && participant.socketId === socket.id) {
        sessionStore.setParticipantConnected(session, socket.data.participantId, false);
        roundEngine.emitLobbyUpdate(session, io);
        io.to(roundEngine.sessionRoom(session.id)).emit('session:participant-status', {
          participantId: socket.data.participantId,
          connected: false
        });
      }
    });
  });
}

module.exports = registerSocketHandlers;
