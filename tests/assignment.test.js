const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeOffsetSequence,
  buildRoundAssignments,
  getArtistForSubjectInRound
} = require('../server/assignment');

function fakeParticipants(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
}

test('computeOffsetSequence: never includes 0 and is a permutation of 1..n-1', () => {
  for (let n = 3; n <= 10; n++) {
    const offsets = computeOffsetSequence(n);
    assert.equal(offsets.length, n - 1, `n=${n} should produce n-1 offsets`);
    assert.ok(!offsets.includes(0), `n=${n} offsets must not include 0`);
    const sorted = [...offsets].sort((a, b) => a - b);
    const expected = Array.from({ length: n - 1 }, (_, i) => i + 1);
    assert.deepEqual(sorted, expected, `n=${n} offsets must be exactly {1..n-1}`);
  }
});

test('buildRoundAssignments: every ordered (artist, subject) pair with artist != subject occurs exactly once', () => {
  for (let n = 3; n <= 10; n++) {
    const participants = fakeParticipants(n);
    const offsets = computeOffsetSequence(n);
    const seen = new Set();
    for (let round = 0; round < n - 1; round++) {
      const assignments = buildRoundAssignments(participants, offsets, round);
      assert.equal(assignments.length, n);
      for (const { artistId, subjectId } of assignments) {
        assert.notEqual(artistId, subjectId, `n=${n} round=${round}: nobody should draw themselves`);
        const key = `${artistId}->${subjectId}`;
        assert.ok(!seen.has(key), `n=${n}: pair ${key} repeated`);
        seen.add(key);
      }
    }
    assert.equal(seen.size, n * (n - 1), `n=${n}: expected every ordered pair exactly once`);
  }
});

test('getArtistForSubjectInRound is the correct inverse of buildRoundAssignments', () => {
  for (let n = 3; n <= 8; n++) {
    const participants = fakeParticipants(n);
    const offsets = computeOffsetSequence(n);
    for (let round = 0; round < n - 1; round++) {
      const assignments = buildRoundAssignments(participants, offsets, round);
      for (const { artistSeat, subjectSeat } of assignments) {
        const derivedArtistSeat = getArtistForSubjectInRound(subjectSeat, round, offsets, n);
        assert.equal(derivedArtistSeat, artistSeat, `n=${n} round=${round} subjectSeat=${subjectSeat}`);
      }
    }
  }
});

test('computeOffsetSequence rejects n < 2', () => {
  assert.throws(() => computeOffsetSequence(1));
  assert.throws(() => computeOffsetSequence(0));
});
