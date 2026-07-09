const { computeOffsetSequence, buildRoundAssignments, getArtistForSubjectInRound } = require('./assignment');
const drawingStorage = require('./drawingStorage');
const config = require('./config');

function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}

function submissionKey(roundIndex, artistId) {
  return `${roundIndex}:${artistId}`;
}

function currentAssignments(session) {
  return buildRoundAssignments(session.participants, session.offsets, session.currentRoundIndex);
}

function emitLobbyUpdate(session, io) {
  io.to(sessionRoom(session.id)).emit('session:lobby-update', {
    status: session.status,
    roundLengthMs: session.roundLengthMs,
    participants: session.participants.map((p) => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      claimed: p.claimed,
      connected: p.connected
    }))
  });
}

function startSession(session, io) {
  if (session.mode === 'baton') {
    session.offsets = [0, ...computeOffsetSequence(session.participants.length)];
    session.totalRounds = session.participants.length;
  } else {
    session.offsets = computeOffsetSequence(session.participants.length);
    session.totalRounds = session.participants.length - 1;
  }
  session.currentRoundIndex = -1;
  advanceToNextRound(session, io);
}

function advanceToNextRound(session, io) {
  session.currentRoundIndex += 1;

  if (session.currentRoundIndex >= session.totalRounds) {
    if (session.mode === 'portrait') {
      startResultsSuspense(session, io);
    } else {
      goToResults(session, io);
    }
    return;
  }

  announceAssignments(session, io);

  if (session.intermissionMs > 0) {
    session.status = 'intermission';
    session.intermissionEndsAt = Date.now() + session.intermissionMs;
    io.to(sessionRoom(session.id)).emit('session:intermission', {
      roundIndex: session.currentRoundIndex,
      totalRounds: session.totalRounds,
      intermissionEndsAt: session.intermissionEndsAt
    });
    session.intermissionTimerHandle = setTimeout(() => {
      beginRound(session, io);
    }, session.intermissionMs);
  } else {
    beginRound(session, io);
  }
}

function announceAssignments(session, io) {
  for (const { artistId, subjectId } of currentAssignments(session)) {
    const artist = session.participants.find((p) => p.id === artistId);
    const subject = session.participants.find((p) => p.id === subjectId);
    if (artist && artist.socketId) {
      const payload = {
        roundIndex: session.currentRoundIndex,
        subjectId,
        subjectName: subject.name
      };
      if (session.mode === 'baton' && session.currentRoundIndex > 0) {
        payload.canvasUrl = `${drawingStorage.batonPngUrlFor(session, subject.name)}?r=${session.currentRoundIndex}`;
      }
      io.to(artist.socketId).emit('round:assignment', payload);
    }
  }
}

function beginRound(session, io) {
  session.status = 'drawing';
  session.roundEndsAt = Date.now() + session.roundLengthMs;

  io.to(sessionRoom(session.id)).emit('session:round-start', {
    roundIndex: session.currentRoundIndex,
    totalRounds: session.totalRounds,
    roundEndsAt: session.roundEndsAt
  });

  emitSubmissionProgress(session, io);

  // The countdown shown to players (and their own auto-submit trigger) is anchored to
  // roundEndsAt above, but a submission timed exactly at that deadline still has to survive
  // client-side polling lag + network/upload time before it reaches this server. Closing the
  // round for new submissions immediately at roundLengthMs would reject those "on time" late
  // arrivals as ROUND_CLOSED. Giving the server a bit longer than the visible countdown fixes
  // that without changing what players see (recordSubmission still ends the round immediately
  // once everyone's in, so this only matters for stragglers).
  session.roundTimerHandle = setTimeout(() => {
    endRound(session, io, session.currentRoundIndex);
  }, session.roundLengthMs + config.SUBMIT_GRACE_MS);
}

function getSubmissionProgress(session) {
  const assignments = currentAssignments(session);
  const submittedCount = assignments.filter((a) =>
    session.submissions.has(submissionKey(session.currentRoundIndex, a.artistId))
  ).length;
  return { roundIndex: session.currentRoundIndex, submittedCount, totalExpected: assignments.length };
}

function emitSubmissionProgress(session, io) {
  io.to(sessionRoom(session.id)).emit('round:submission-progress', getSubmissionProgress(session));
}

function recordSubmission(session, io, { roundIndex, artistId, pngPath }) {
  if (session.status !== 'drawing' || roundIndex !== session.currentRoundIndex) {
    return { ok: false, code: 'ROUND_CLOSED' };
  }
  const assignments = currentAssignments(session);
  const assignment = assignments.find((a) => a.artistId === artistId);
  if (!assignment) return { ok: false, code: 'NOT_YOUR_ROUND' };

  session.submissions.set(submissionKey(roundIndex, artistId), {
    roundIndex,
    artistId,
    subjectId: assignment.subjectId,
    pngPath,
    submittedAt: Date.now(),
    autoSubmitted: false
  });

  emitSubmissionProgress(session, io);

  const allIn = assignments.every((a) => session.submissions.has(submissionKey(roundIndex, a.artistId)));
  if (allIn) {
    endRound(session, io, roundIndex);
  }
  return { ok: true };
}

function endRound(session, io, roundIndex) {
  if (session.status !== 'drawing' || roundIndex !== session.currentRoundIndex) return;
  clearTimeout(session.roundTimerHandle);
  session.roundTimerHandle = null;

  for (const { artistId, subjectId } of currentAssignments(session)) {
    if (!session.submissions.has(submissionKey(roundIndex, artistId))) {
      session.submissions.set(submissionKey(roundIndex, artistId), {
        roundIndex,
        artistId,
        subjectId,
        pngPath: null,
        submittedAt: Date.now(),
        autoSubmitted: true
      });
    }
  }

  io.to(sessionRoom(session.id)).emit('round:end', { roundIndex });
  advanceToNextRound(session, io);
}

function forceAdvance(session, io) {
  if (session.status === 'intermission') {
    clearTimeout(session.intermissionTimerHandle);
    beginRound(session, io);
    return { ok: true };
  }
  if (session.status === 'drawing') {
    endRound(session, io, session.currentRoundIndex);
    return { ok: true };
  }
  if (session.status === 'reveal-wait') {
    clearTimeout(session.revealTimerHandle);
    goToResults(session, io);
    return { ok: true };
  }
  return { ok: false, code: 'NO_ACTIVE_ROUND' };
}

function getPortraitsForParticipant(session, participantId) {
  const subject = session.participants.find((p) => p.id === participantId);
  if (!subject) return [];
  const n = session.participants.length;

  const portraits = [];
  for (let roundIndex = 0; roundIndex < session.totalRounds; roundIndex++) {
    const artistSeat = getArtistForSubjectInRound(subject.seatIndex, roundIndex, session.offsets, n);
    const artist = session.participants[artistSeat];
    const submission = session.submissions.get(submissionKey(roundIndex, artist.id));
    portraits.push({
      portraitId: `${roundIndex}-${artist.id}-${subject.id}`,
      roundIndex,
      pngUrl: submission && submission.pngPath
        ? drawingStorage.pngUrlFor(session, roundIndex, subject.name, artist.name)
        : null,
      missing: !submission || !submission.pngPath
    });
  }
  return portraits;
}

function getArtistDrawing(session, participantId) {
  const submission = session.submissions.get(submissionKey(0, participantId));
  if (!submission) return null;
  const artist = session.participants.find((p) => p.id === participantId);
  const subject = session.participants.find((p) => p.id === submission.subjectId);
  return {
    pngUrl: submission.pngPath
      ? drawingStorage.pngUrlFor(session, 0, subject.name, artist.name)
      : null,
    missing: !submission.pngPath
  };
}

function getFinalCanvasForOwner(session, ownerId) {
  const owner = session.participants.find((p) => p.id === ownerId);
  if (!owner) return null;
  const n = session.participants.length;
  let everWritten = false;
  for (let roundIndex = 0; roundIndex < session.totalRounds; roundIndex++) {
    const artistSeat = getArtistForSubjectInRound(owner.seatIndex, roundIndex, session.offsets, n);
    const artist = session.participants[artistSeat];
    const submission = session.submissions.get(submissionKey(roundIndex, artist.id));
    if (submission && submission.pngPath) everWritten = true;
  }
  return {
    pngUrl: everWritten ? drawingStorage.batonPngUrlFor(session, owner.name) : null,
    missing: !everWritten
  };
}

function getBatonGallery(session, participantId) {
  const ordered = [
    session.participants.find((p) => p.id === participantId),
    ...session.participants.filter((p) => p.id !== participantId)
  ];
  return ordered.map((owner) => {
    const canvas = getFinalCanvasForOwner(session, owner.id);
    return {
      portraitId: `baton-${owner.id}`,
      ownerName: owner.name,
      isMine: owner.id === participantId,
      pngUrl: canvas.pngUrl,
      missing: canvas.missing
    };
  });
}

function startResultsSuspense(session, io) {
  session.status = 'reveal-wait';
  session.revealEndsAt = Date.now() + config.RESULTS_SUSPENSE_MS;
  io.to(sessionRoom(session.id)).emit('session:reveal-wait', { revealEndsAt: session.revealEndsAt });
  session.revealTimerHandle = setTimeout(() => {
    goToResults(session, io);
  }, config.RESULTS_SUSPENSE_MS);
}

function goToResults(session, io) {
  clearTimeout(session.revealTimerHandle);
  session.revealTimerHandle = null;
  session.status = 'results';
  drawingStorage.finalizeSessionFolder(session).catch((err) => console.error('세션 폴더 정리 실패:', err));
  io.to(sessionRoom(session.id)).emit('session:results-ready', { status: 'results' });

  for (const participant of session.participants) {
    if (!participant.socketId) continue;
    let payload;
    if (session.mode === 'baton') {
      payload = { mode: session.mode, portraits: getBatonGallery(session, participant.id) };
    } else {
      payload = { mode: session.mode, portraits: getPortraitsForParticipant(session, participant.id) };
      if (session.mode === 'portrait') {
        payload.myDrawing = getArtistDrawing(session, participant.id);
      }
    }
    io.to(participant.socketId).emit('results:your-portraits', payload);
  }
}

module.exports = {
  sessionRoom,
  submissionKey,
  startSession,
  beginRound,
  recordSubmission,
  endRound,
  forceAdvance,
  goToResults,
  getPortraitsForParticipant,
  getArtistDrawing,
  getFinalCanvasForOwner,
  getBatonGallery,
  getSubmissionProgress,
  emitLobbyUpdate,
  emitSubmissionProgress,
  currentAssignments
};
