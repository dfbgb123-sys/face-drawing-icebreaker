const express = require('express');
const path = require('path');
const config = require('./config');
const network = require('./network');
const qr = require('./qr');
const sessionStore = require('./sessionStore');
const roundEngine = require('./roundEngine');
const drawingStorage = require('./drawingStorage');

function publicParticipant(p) {
  return { id: p.id, name: p.name, seatIndex: p.seatIndex, claimed: p.claimed, connected: p.connected };
}

function joinUrlFor(req) {
  const candidates = network.getLocalIPv4Candidates();
  const host = (candidates[0] && candidates[0].address) || req.hostname;
  return `http://${host}:${config.PORT}/`;
}

function createRouter(io) {
  const router = express.Router();

  router.post('/api/sessions', express.json(), async (req, res) => {
    const { participantNames, roundLengthMs, intermissionMs, forceReplace } = req.body || {};
    try {
      const session = sessionStore.createSession(
        { participantNames, roundLengthMs, intermissionMs },
        { forceReplace: Boolean(forceReplace) }
      );
      const joinUrl = joinUrlFor(req);
      const qrDataUrl = await qr.toDataUrl(joinUrl);
      console.log(`\n참가자 입장 링크: ${joinUrl}`);
      res.json({
        sessionId: session.id,
        joinUrl,
        qrDataUrl,
        participants: session.participants.map(publicParticipant),
        roundLengthMs: session.roundLengthMs,
        totalRounds: session.totalRounds
      });
    } catch (err) {
      if (err.code === 'SESSION_ACTIVE') {
        return res.status(409).json({ code: err.code, message: err.message });
      }
      if (err.code === 'TOO_FEW_PARTICIPANTS' || err.code === 'DUPLICATE_NAMES') {
        return res.status(400).json({ code: err.code, message: err.message, duplicates: err.duplicates });
      }
      console.error(err);
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Failed to create session' });
    }
  });

  router.get('/api/sessions/active', (req, res) => {
    const session = sessionStore.getActiveSession();
    if (!session) return res.json({ session: null });
    res.json({
      session: {
        id: session.id,
        status: session.status,
        roundLengthMs: session.roundLengthMs,
        totalRounds: session.totalRounds,
        participants: session.participants.map(publicParticipant)
      }
    });
  });

  router.post(
    '/api/sessions/:id/drawings',
    express.raw({ type: 'image/png', limit: config.MAX_PNG_BYTES }),
    async (req, res) => {
      const session = sessionStore.getSession(req.params.id);
      if (!session) return res.status(404).json({ code: 'SESSION_NOT_FOUND' });

      const { participantId, clientToken } = req.query;
      const roundIndex = Number(req.query.roundIndex);
      const artist = sessionStore.findParticipantById(session, participantId);
      if (!artist || !artist.claimed || artist.clientToken !== clientToken) {
        return res.status(403).json({ code: 'INVALID_TOKEN' });
      }

      const assignments = roundEngine.currentAssignments(session);
      const assignment = assignments.find((a) => a.artistId === artist.id);
      if (session.status !== 'drawing' || roundIndex !== session.currentRoundIndex || !assignment) {
        return res.status(409).json({ code: 'ROUND_CLOSED' });
      }

      try {
        const subject = sessionStore.findParticipantById(session, assignment.subjectId);
        const pngPath = await drawingStorage.saveDrawing(
          session,
          roundIndex,
          subject.name,
          artist.name,
          req.body
        );
        const result = roundEngine.recordSubmission(session, io, {
          roundIndex,
          artistId: artist.id,
          pngPath
        });
        res.json(result);
      } catch (err) {
        if (err.code === 'INVALID_PNG') {
          return res.status(400).json({ code: err.code, message: err.message });
        }
        console.error(err);
        res.status(500).json({ code: 'INTERNAL_ERROR' });
      }
    }
  );

  router.get('/api/sessions/:id/drawings/:filename', (req, res) => {
    const { id, filename } = req.params;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || !filename.endsWith('.png')) {
      return res.status(400).end();
    }
    const session = sessionStore.getSession(id);
    if (!session) return res.status(404).end();

    const filePath = path.join(drawingStorage.dirPathFor(session), filename);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).end();
    });
  });

  router.get('/api/qr', async (req, res) => {
    const text = req.query.url;
    if (!text) return res.status(400).json({ code: 'MISSING_URL' });
    const dataUrl = await qr.toDataUrl(String(text));
    res.json({ dataUrl });
  });

  return router;
}

module.exports = createRouter;
