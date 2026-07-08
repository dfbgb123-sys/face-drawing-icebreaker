const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isValidPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function formatTime(d) {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function sanitizeForFilename(name) {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || '이름없음';
}

function buildInitialDirName(ordinal, startedAtMs) {
  const d = new Date(startedAtMs);
  return `${ordinal}회차_${formatDate(d)}_${formatTime(d)}`;
}

function finalizeDirName(ordinal, startedAtMs, endedAtMs) {
  const start = new Date(startedAtMs);
  const end = new Date(endedAtMs);
  return `${ordinal}회차_${formatDate(start)}_${formatTime(start)}-${formatTime(end)}`;
}

function dirPathFor(session) {
  return path.join(SESSIONS_DIR, session.storageDirName);
}

function fileNameFor(roundIndex, subjectName, artistName) {
  return `R${roundIndex + 1}_${sanitizeForFilename(subjectName)}(대상)-${sanitizeForFilename(artistName)}(작가).png`;
}

function pngUrlFor(session, roundIndex, subjectName, artistName) {
  const filename = fileNameFor(roundIndex, subjectName, artistName);
  return `/api/sessions/${session.id}/drawings/${encodeURIComponent(filename)}`;
}

async function saveDrawing(session, roundIndex, subjectName, artistName, buffer) {
  if (!isValidPng(buffer)) {
    const err = new Error('Uploaded data is not a valid PNG');
    err.code = 'INVALID_PNG';
    throw err;
  }
  const dir = dirPathFor(session);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileNameFor(roundIndex, subjectName, artistName));
  await fsp.writeFile(filePath, buffer);
  return filePath;
}

async function finalizeSessionFolder(session) {
  if (session.storageDirFinalized) return;
  session.storageDirFinalized = true;

  const oldDir = dirPathFor(session);
  const newName = finalizeDirName(session.ordinal, session.createdAt, Date.now());
  const newDir = path.join(SESSIONS_DIR, newName);

  try {
    await fsp.rename(oldDir, newDir);
    session.storageDirName = newName;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  saveDrawing,
  finalizeSessionFolder,
  buildInitialDirName,
  dirPathFor,
  fileNameFor,
  pngUrlFor,
  isValidPng
};
