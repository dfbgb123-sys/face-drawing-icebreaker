const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOffsetSequence, buildRoundAssignments } = require('../server/assignment');

// roundEngine.startSession()이 baton 모드에서 실제로 세팅하는 방식과 동일하게 재현한다.
// (server/roundEngine.js: offsets = [0, ...computeOffsetSequence(n)], totalRounds = n)
function batonOffsets(n) {
  return [0, ...computeOffsetSequence(n)];
}

function fakeParticipants(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
}

test('바톤터치: 라운드 오프셋은 0을 포함해 0..n-1의 순열이다 (한 사이클 안에 중복/누락 없음)', () => {
  for (let n = 2; n <= 15; n++) {
    const offsets = batonOffsets(n);
    assert.equal(offsets.length, n, `n=${n}: 총 라운드 수는 참가자 수와 같아야 함`);
    assert.equal(offsets[0], 0, `n=${n}: 1라운드는 항상 자기 자신(offset 0)부터 시작해야 함`);
    const sorted = [...offsets].sort((a, b) => a - b);
    assert.deepEqual(sorted, Array.from({ length: n }, (_, i) => i), `n=${n}: offset 집합은 0..n-1 정확히 한 번씩이어야 함`);
  }
});

test('바톤터치: 한 사람의 캔버스는 전체 라운드 동안 자기 자신 포함 전원에게 정확히 한 번씩만 배정된다 (중복 없음, 누락 없음)', () => {
  for (let n = 2; n <= 15; n++) {
    const participants = fakeParticipants(n);
    const offsets = batonOffsets(n);
    const totalRounds = n;

    // ownerSeat(캔버스 주인) 기준으로, 각 라운드에서 누가 그 캔버스를 그렸는지 수집
    const artistsPerOwner = Array.from({ length: n }, () => []);

    for (let round = 0; round < totalRounds; round++) {
      const assignments = buildRoundAssignments(participants, offsets, round);
      assert.equal(assignments.length, n, `n=${n} round=${round}: 라운드마다 전원이 정확히 하나의 캔버스를 맡아야 함`);

      const artistSeatsThisRound = assignments.map((a) => a.artistSeat);
      const uniqueArtists = new Set(artistSeatsThisRound);
      assert.equal(uniqueArtists.size, n, `n=${n} round=${round}: 같은 라운드에 중복으로 배정된 작가가 있음 (${artistSeatsThisRound})`);

      const ownerSeatsThisRound = assignments.map((a) => a.subjectSeat);
      const uniqueOwners = new Set(ownerSeatsThisRound);
      assert.equal(uniqueOwners.size, n, `n=${n} round=${round}: 같은 라운드에 캔버스가 중복/누락 배정됨 (${ownerSeatsThisRound})`);

      for (const { artistSeat, subjectSeat } of assignments) {
        artistsPerOwner[subjectSeat].push(artistSeat);
        if (round === 0) {
          assert.equal(artistSeat, subjectSeat, `n=${n}: 1라운드는 본인이 본인 캔버스를 그려야 함 (owner=${subjectSeat})`);
        }
      }
    }

    for (let ownerSeat = 0; ownerSeat < n; ownerSeat++) {
      const artists = artistsPerOwner[ownerSeat];
      assert.equal(artists.length, n, `n=${n} owner=${ownerSeat}: 전체 라운드 수만큼 캔버스가 다뤄져야 함`);
      const uniqueArtists = new Set(artists);
      assert.equal(uniqueArtists.size, n, `n=${n} owner=${ownerSeat}: 같은 사람이 같은 캔버스를 두 번 그림 (누락된 사람이 생겼다는 뜻) — artists=${artists}`);
      const sorted = [...uniqueArtists].sort((a, b) => a - b);
      assert.deepEqual(sorted, Array.from({ length: n }, (_, i) => i), `n=${n} owner=${ownerSeat}: 전원이 정확히 한 번씩 이 캔버스를 그려야 함`);
    }
  }
});
