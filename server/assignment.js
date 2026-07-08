function computeOffsetSequence(n) {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`computeOffsetSequence requires an integer n >= 2, got ${n}`);
  }
  const start = Math.floor(n / 2);
  const offsets = [];
  for (let o = start; o <= n - 1; o++) offsets.push(o);
  for (let o = 1; o <= start - 1; o++) offsets.push(o);
  return offsets;
}

function buildRoundAssignments(participants, offsets, roundIndex) {
  const n = participants.length;
  const offset = offsets[roundIndex];
  const assignments = [];
  for (let artistSeat = 0; artistSeat < n; artistSeat++) {
    const subjectSeat = (artistSeat + offset) % n;
    assignments.push({
      artistSeat,
      artistId: participants[artistSeat].id,
      subjectSeat,
      subjectId: participants[subjectSeat].id
    });
  }
  return assignments;
}

function getArtistForSubjectInRound(subjectSeat, roundIndex, offsets, n) {
  const offset = offsets[roundIndex];
  return ((subjectSeat - offset) % n + n) % n;
}

module.exports = { computeOffsetSequence, buildRoundAssignments, getArtistForSubjectInRound };
