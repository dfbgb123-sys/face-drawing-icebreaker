const crypto = require('crypto');
const config = require('./config');
const drawingStorage = require('./drawingStorage');

const sessions = new Map();
let activeSessionId = null;
let sessionOrdinal = 0;

function getActiveSession() {
  return activeSessionId ? sessions.get(activeSessionId) : null;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function createSession({ participantNames, roundLengthMs, intermissionMs }, { forceReplace = false } = {}) {
  const names = (participantNames || []).map((n) => n.trim()).filter(Boolean);

  if (names.length < config.MIN_PARTICIPANTS) {
    const err = new Error(`Need at least ${config.MIN_PARTICIPANTS} participants`);
    err.code = 'TOO_FEW_PARTICIPANTS';
    throw err;
  }

  const seen = new Set();
  const duplicates = new Set();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    const err = new Error(`Duplicate participant names: ${[...duplicates].join(', ')}`);
    err.code = 'DUPLICATE_NAMES';
    err.duplicates = [...duplicates];
    throw err;
  }

  const existing = getActiveSession();
  if (existing && existing.status !== 'ended' && !forceReplace) {
    const err = new Error('A session is already active');
    err.code = 'SESSION_ACTIVE';
    throw err;
  }
  if (existing) {
    existing.status = 'ended';
    clearTimeout(existing.roundTimerHandle);
    clearTimeout(existing.intermissionTimerHandle);
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  sessionOrdinal += 1;
  const session = {
    id,
    ordinal: sessionOrdinal,
    status: 'lobby',
    createdAt,
    storageDirName: drawingStorage.buildInitialDirName(sessionOrdinal, createdAt),
    roundLengthMs: roundLengthMs || config.DEFAULT_ROUND_MS,
    intermissionMs: intermissionMs != null ? intermissionMs : config.INTERMISSION_MS,
    participants: names.map((name, seatIndex) => ({
      id: crypto.randomUUID(),
      name,
      seatIndex,
      claimed: false,
      connected: false,
      socketId: null,
      clientToken: null,
      joinedAt: null
    })),
    offsets: [],
    currentRoundIndex: -1,
    totalRounds: names.length - 1,
    roundEndsAt: null,
    intermissionEndsAt: null,
    roundTimerHandle: null,
    intermissionTimerHandle: null,
    submissions: new Map(),
    guesses: new Map(),
    hostSocketId: null
  };

  sessions.set(id, session);
  activeSessionId = id;
  return session;
}

function findParticipantByName(session, name) {
  return session.participants.find((p) => p.name === name) || null;
}

function findParticipantById(session, participantId) {
  return session.participants.find((p) => p.id === participantId) || null;
}

function claimParticipant(session, participantId, socketId) {
  const p = findParticipantById(session, participantId);
  if (!p) return null;
  p.claimed = true;
  p.connected = true;
  p.socketId = socketId;
  p.clientToken = crypto.randomUUID();
  p.joinedAt = Date.now();
  return p;
}

function reconnectParticipant(session, participantId, clientToken, socketId) {
  const p = findParticipantById(session, participantId);
  if (!p || !p.claimed || p.clientToken !== clientToken) return null;
  p.connected = true;
  p.socketId = socketId;
  return p;
}

function setParticipantConnected(session, participantId, connected) {
  const p = findParticipantById(session, participantId);
  if (!p) return null;
  p.connected = connected;
  if (!connected) p.socketId = null;
  return p;
}

function removeParticipant(session, participantId) {
  if (session.status !== 'lobby') return false;
  if (session.participants.length - 1 < config.MIN_PARTICIPANTS) return false;
  const idx = session.participants.findIndex((p) => p.id === participantId);
  if (idx === -1) return false;
  session.participants.splice(idx, 1);
  session.participants.forEach((p, seatIndex) => {
    p.seatIndex = seatIndex;
  });
  session.totalRounds = session.participants.length - 1;
  return true;
}

module.exports = {
  createSession,
  getSession,
  getActiveSession,
  findParticipantByName,
  findParticipantById,
  claimParticipant,
  reconnectParticipant,
  setParticipantConnected,
  removeParticipant
};
