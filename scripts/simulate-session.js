// 여러 명이 동시에 실제 브라우저로 접속했을 때 생기는 예외상황을 혼자서 재현하기 위한 시뮬레이터.
//
// 진짜 서버를 별도 포트로 띄우고, Playwright로 진행자 화면 1개 + 참가자 화면 N개를
// 각각 독립된 브라우저 컨텍스트로 열어 실제 클릭/드로잉/제출을 흉내낸다.
// 중간에 와이파이 끊김, 지각 제출, 무제출(타임아웃 자동제출) 같은 "사람이 할 법한" 변수를
// --chaos 옵션으로 랜덤하게 섞어서 서버/클라이언트에서 에러나 이상 화면이 뜨는지 관찰한다.
//
// 사용법:
//   node scripts/simulate-session.js --mode=multi --participants=5 --round-min=0.2 --chaos
//   node scripts/simulate-session.js --mode=portrait --headed
//   node scripts/simulate-session.js --mode=baton --participants=6 --chaos --headed --slowmo=100

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const LOG_DIR = path.join(__dirname, '..', 'sim-logs');
const logLines = [];

function parseArgs(argv) {
  const args = { mode: 'multi', participants: 4, roundMin: 0.2, chaos: false, headed: false, slowmo: 0, port: 3100 };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'mode') args.mode = value;
    else if (key === 'participants') args.participants = Number(value);
    else if (key === 'round-min') args.roundMin = Number(value);
    else if (key === 'chaos') args.chaos = true;
    else if (key === 'headed') args.headed = true;
    else if (key === 'slowmo') args.slowmo = Number(value);
    else if (key === 'port') args.port = Number(value);
  }
  if (args.mode === 'portrait') args.participants = 2;
  return args;
}

const NAMES_POOL = ['유지', '민서', '하늘', '다온', '서연', '지호', '예린', 'carlos', '수아', '준서', '나연', '도윤', '하은', '시우', '채원'];

function log(tag, msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  const line = `[${ts}] [${tag}] ${msg}`;
  logLines.push(line);
  console.log(line);
}

// 리포트 구간처럼 태그 없이 그냥 줄글로 출력하는 부분도 같은 로그 파일에 남기기 위한 헬퍼.
function reportLine(line) {
  logLines.push(line);
  console.log(line);
}

function writeLogFile(args) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const chaosTag = args.chaos ? '_chaos' : '';
  const filename = `${stamp}_${args.mode}_p${args.participants}${chaosTag}.log`;
  const filePath = path.join(LOG_DIR, filename);
  fs.writeFileSync(filePath, logLines.join('\n') + '\n', 'utf8');
  return filePath;
}

async function waitForServer(port, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/sessions/active`);
      if (res.ok) return;
    } catch (_) {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 ${port} 포트에서 응답하지 않았습니다.`);
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const serverLines = [];
  child.stdout.on('data', (d) => serverLines.push(`OUT ${d}`));
  child.stderr.on('data', (d) => serverLines.push(`ERR ${d}`));
  return { child, serverLines };
}

async function drawScribble(page) {
  const canvas = page.locator('#pad');
  const box = await canvas.boundingBox();
  if (!box) return;
  const strokes = 3 + Math.floor(Math.random() * 3);
  for (let s = 0; s < strokes; s++) {
    const x1 = box.x + Math.random() * box.width;
    const y1 = box.y + Math.random() * box.height;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let i = 0; i < 6; i++) {
      const x = box.x + Math.random() * box.width;
      const y = box.y + Math.random() * box.height;
      await page.mouse.move(x, y, { steps: 4 });
    }
    await page.mouse.up();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = NAMES_POOL.slice(0, args.participants);
  const anomalies = [];

  function reportAnomaly(source, detail) {
    anomalies.push({ source, detail, at: new Date().toISOString() });
    log('ANOMALY', `${source}: ${detail}`);
  }

  log('SETUP', `mode=${args.mode} participants=${args.participants} roundMin=${args.roundMin} chaos=${args.chaos} port=${args.port}`);
  log('SETUP', `서버를 포트 ${args.port}에서 별도로 실행합니다 (기존 로컬 서버와 무관).`);

  const { child: serverProcess, serverLines } = startServer(args.port);
  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) reportAnomaly('server-process', `서버가 예기치 않게 종료됨 (exit code ${code})`);
  });

  await waitForServer(args.port);
  log('SETUP', '서버 응답 확인됨.');

  const browser = await chromium.launch({ headless: !args.headed, slowMo: args.slowmo || undefined });
  const baseUrl = `http://localhost:${args.port}`;
  let batonContinuationLoads = 0;

  function attachDiagnostics(page, label) {
    page.on('pageerror', (err) => reportAnomaly(label, `페이지 JS 예외: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') reportAnomaly(label, `콘솔 에러: ${msg.text()}`);
    });
    page.on('crash', () => reportAnomaly(label, '페이지 크래시'));
    page.on('dialog', async (dialog) => {
      log(label, `다이얼로그 자동 수락: ${dialog.message()}`);
      await dialog.accept();
    });
    if (args.mode === 'baton') {
      page.on('response', (res) => {
        const url = res.url();
        if (!url.includes('/drawings/BATON_')) return;
        if (!res.ok()) {
          reportAnomaly(label, `바톤 캔버스 배경 로드 실패 (HTTP ${res.status()}): ${url}`);
        } else {
          batonContinuationLoads += 1;
          log(label, `이전 라운드 캔버스 배경 로드 성공: ${url.split('/').pop()}`);
        }
      });
    }
  }

  // ---- 진행자(host) 세션 생성 ----
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  attachDiagnostics(hostPage, 'host');
  await hostPage.goto(`${baseUrl}/host`);

  await hostPage.click(`.mode-btn[data-mode="${args.mode}"]`);
  await hostPage.fill('#names', names.join('\n'));
  await hostPage.fill('#roundLength', String(args.roundMin));
  await hostPage.click('#create-btn');

  try {
    await hostPage.waitForSelector('#view-lobby', { state: 'visible', timeout: 5000 });
  } catch (err) {
    const errText = await hostPage.locator('#setup-error').textContent().catch(() => null);
    reportAnomaly('host', `세션 생성 실패 (로비 화면 미표시). setup-error="${errText}"`);
    await teardown();
    return;
  }
  log('host', '세션 생성 완료, 로비 표시됨.');

  // ---- 참가자들 입장 (실제 사람처럼 무작위 지연 + 순서로 접속) ----
  const players = [];
  for (const name of names) {
    const context = await browser.newContext();
    const page = await context.newPage();
    attachDiagnostics(page, `player:${name}`);
    players.push({ name, context, page, submittedRounds: new Set(), chaosRole: null });
  }

  // 챗스: 한 명은 접속이 느리고(지각 입장), 한 명은 이름 중복 클릭 경쟁을 시켜본다.
  if (args.chaos && players.length >= 2) {
    players[0].chaosRole = 'late-joiner';
    players[1].chaosRole = 'flaky-wifi';
    if (players.length >= 3) players[2].chaosRole = 'never-submit';
    if (players.length >= 4) players[3].chaosRole = 'last-second-submit';
    if (players.length >= 5) players[4].chaosRole = 'reload-mid-round';
  }

  async function joinPlayer(p) {
    await p.page.goto(baseUrl);
    await p.page.waitForSelector('#view-join', { state: 'visible', timeout: 8000 }).catch(() => {
      reportAnomaly(`player:${p.name}`, '입장 화면(view-join)이 뜨지 않음');
    });
    const nameButton = p.page.locator('#name-grid button', { hasText: p.name });
    await nameButton.click({ timeout: 5000 }).catch((err) => {
      reportAnomaly(`player:${p.name}`, `이름 버튼 클릭 실패: ${err.message}`);
    });
    const ok = await p.page.waitForSelector('#view-lobby', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) reportAnomaly(`player:${p.name}`, '입장 후 로비 화면으로 전환되지 않음');
    else log(`player:${p.name}`, '입장 완료.');
  }

  // 동시 이름 클릭 경쟁(레이스) 시나리오: 같은 이름을 두 브라우저가 동시에 클릭하면
  // 서버가 NAME_TAKEN을 정확히 한쪽에만 내려주는지 확인한다.
  if (args.chaos && players.length >= 2) {
    const [a, b] = players;
    await a.page.goto(baseUrl);
    await b.page.goto(baseUrl);
    await Promise.all([
      a.page.waitForSelector('#view-join', { state: 'visible' }),
      b.page.waitForSelector('#view-join', { state: 'visible' })
    ]);
    log('chaos', `${a.name} 이름으로 동시 입장 경쟁 재현...`);
    const [resA, resB] = await Promise.allSettled([
      a.page.locator('#name-grid button', { hasText: a.name }).click(),
      b.page.locator('#name-grid button', { hasText: a.name }).click()
    ]);
    await Promise.all([a.page, b.page].map((pg) => pg.waitForTimeout(300)));
    const aInLobby = await a.page.locator('#view-lobby').isVisible();
    const bInLobby = await b.page.locator('#view-lobby').isVisible();
    if (aInLobby && bInLobby) {
      reportAnomaly('chaos:name-race', `${a.name} 이름을 두 브라우저가 동시에 입장 성공 (중복 클레임 가능성)`);
    } else {
      log('chaos', `이름 경쟁 결과: a=${aInLobby ? 'joined' : 'blocked'}, b=${bInLobby ? 'joined' : 'blocked'}`);
    }
    // b는 실패했을 테니 자기 이름으로 다시 정상 입장시킨다.
    if (!bInLobby) await joinPlayer(b);
  }

  for (const p of players) {
    if (p.chaosRole === 'flaky-wifi' && p.page.url() === 'about:blank') {
      // 위 경쟁 시나리오에서 이미 처리됐을 수 있음
    }
    if (p.page.url() === 'about:blank' || !p.page.url().startsWith(baseUrl)) {
      const delay = p.chaosRole === 'late-joiner' ? 1500 : Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
      await joinPlayer(p);
    }
  }

  // ---- 진행자가 시작 ----
  await hostPage.click('#start-btn');
  log('host', '세션 시작 버튼 클릭.');

  const totalRounds = args.mode === 'baton' ? names.length : args.mode === 'portrait' ? 1 : names.length - 1;
  const roundMs = Math.round(args.roundMin * 60 * 1000);

  for (let round = 0; round < totalRounds; round++) {
    log('round', `라운드 ${round + 1}/${totalRounds} 대기 중...`);
    await Promise.all(
      players.map(async (p) => {
        const shown = await p.page
          .waitForSelector('#view-drawing', { state: 'visible', timeout: roundMs + 15000 })
          .then(() => true)
          .catch(() => false);
        if (!shown) {
          reportAnomaly(`player:${p.name}`, `라운드 ${round + 1}: 드로잉 화면이 뜨지 않음 (인터미션에서 멈췄을 가능성)`);
        }
      })
    );

    await Promise.all(
      players.map(async (p) => {
        if (p.chaosRole === 'never-submit') {
          log(`player:${p.name}`, `라운드 ${round + 1}: 의도적으로 제출하지 않고 타임아웃(자동 제출) 유도.`);
          return;
        }

        await drawScribble(p.page).catch((err) => reportAnomaly(`player:${p.name}`, `드로잉 중 오류: ${err.message}`));

        if (p.chaosRole === 'reload-mid-round') {
          log(`player:${p.name}`, `라운드 ${round + 1}: 브라우저 새로고침(재접속) 재현.`);
          await p.page.reload();
          const backToDrawing = await p.page
            .waitForSelector('#view-drawing', { state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (!backToDrawing) {
            reportAnomaly(`player:${p.name}`, `새로고침 후 드로잉 화면으로 복귀하지 못함 (재접속 복구 실패 의심)`);
          } else {
            const stillMyRound = await p.page.locator('#drawing-subject-name').textContent().catch(() => '');
            if (!stillMyRound) reportAnomaly(`player:${p.name}`, '새로고침 후 라운드 정보(대상 이름)가 비어있음');
            await drawScribble(p.page).catch((err) => reportAnomaly(`player:${p.name}`, `새로고침 후 드로잉 오류: ${err.message}`));
          }
        }

        if (p.chaosRole === 'flaky-wifi') {
          log(`player:${p.name}`, `라운드 ${round + 1}: 와이파이 끊김 재현 (offline 전환).`);
          await p.context.setOffline(true);
          await p.page.waitForTimeout(Math.min(roundMs * 0.4, 4000));
          await p.context.setOffline(false);
          log(`player:${p.name}`, '와이파이 복구, 재연결 시도.');
          await p.page.waitForTimeout(500);
        }

        if (p.chaosRole === 'last-second-submit') {
          await p.page.waitForTimeout(Math.max(roundMs - 800, 0));
        }

        const submitBtn = p.page.locator('#submit-btn');
        const disabled = await submitBtn.isDisabled().catch(() => true);
        if (!disabled) {
          await submitBtn.click().catch((err) => reportAnomaly(`player:${p.name}`, `제출 버튼 클릭 실패: ${err.message}`));
          log(`player:${p.name}`, `라운드 ${round + 1}: 제출함.`);
        }
      })
    );

    await Promise.all(
      players.map(async (p) => {
        const stillDrawing = await p.page.locator('#view-drawing').isVisible().catch(() => false);
        if (!stillDrawing) return;
        const movedOn = await Promise.race([
          p.page.waitForSelector('#view-intermission', { state: 'visible', timeout: roundMs + 20000 }).then(() => true),
          p.page.waitForSelector('#view-reveal', { state: 'visible', timeout: roundMs + 20000 }).then(() => true),
          p.page.waitForSelector('#view-results', { state: 'visible', timeout: roundMs + 20000 }).then(() => true)
        ]).catch(() => false);
        if (!movedOn) reportAnomaly(`player:${p.name}`, `라운드 ${round + 1} 종료 후 다음 화면으로 전환되지 않음 (자동 제출 실패 의심)`);
      })
    );
  }

  // ---- 결과 화면 ----
  log('results', '모든 라운드 종료, 결과 화면 대기...');
  await Promise.all(
    players.map(async (p) => {
      const ok = await p.page.waitForSelector('#view-results', { state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
      if (!ok) reportAnomaly(`player:${p.name}`, '결과 화면이 뜨지 않음');
    })
  );
  await hostPage.waitForSelector('#view-results', { state: 'visible', timeout: 20000 }).catch(() => {
    reportAnomaly('host', '진행자 화면에서 결과 화면이 뜨지 않음');
  });

  for (const p of players) {
    const missingCount = await p.page.locator('.portrait-missing').count().catch(() => 0);
    if (missingCount > 0 && args.mode !== 'portrait') {
      const total = await p.page.locator('#portrait-position').textContent().catch(() => '?');
      log(`player:${p.name}`, `누락된 그림 있음 (자동제출/미제출 반영, 정상일 수 있음) — 위치 표시: ${total}`);
    }

    if (args.mode === 'baton') {
      // 갤러리를 끝까지 넘겨보며, 내 캔버스를 포함해 전원의 완성작이 실제로 로드되는지 확인.
      // (모든 참가자가 정상 제출한 non-chaos 실행에서는 missing이나 깨진 이미지가 하나도 없어야 정상)
      for (let i = 0; i < names.length; i++) {
        const ownerLabel = await p.page.locator('#portrait-owner-label').textContent().catch(() => '');
        const isMissing = (await p.page.locator('#portrait-card .portrait-missing').count().catch(() => 0)) > 0;
        if (isMissing) {
          if (!args.chaos) {
            reportAnomaly(`player:${p.name}`, `바톤 갤러리 "${ownerLabel}" 캔버스가 누락으로 표시됨 (전원 정상 제출했는데도 missing)`);
          } else {
            log(`player:${p.name}`, `갤러리 "${ownerLabel}": missing (chaos로 인한 예상된 상황일 수 있음)`);
          }
        } else {
          const img = p.page.locator('#portrait-card img');
          const naturalWidth = await img.evaluate((el) => el.naturalWidth).catch(() => 0);
          if (!naturalWidth) {
            reportAnomaly(`player:${p.name}`, `바톤 갤러리 "${ownerLabel}" 이미지가 깨져서 로드됨 (naturalWidth=0)`);
          } else {
            log(`player:${p.name}`, `갤러리 "${ownerLabel}": 캔버스 정상 로드 확인 (${naturalWidth}px).`);
          }
        }
        await p.page.locator('#next-btn').click().catch(() => {});
        await p.page.waitForTimeout(120);
      }
    }

    if (args.mode !== 'baton') {
      const guessOptions = p.page.locator('.guess-option');
      const count = await guessOptions.count().catch(() => 0);
      if (count > 0) {
        await guessOptions.first().click().catch(() => {});
        await p.page.waitForTimeout(150);
        await p.page.locator('#reveal-btn').click().catch(() => {});
        const revealed = await p.page
          .waitForSelector('#reveal-result .reveal-result', { state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        if (!revealed) reportAnomaly(`player:${p.name}`, '정답 공개(reveal) 클릭 후 결과가 표시되지 않음');
      }
    }
  }

  log('teardown', '진행자 세션 종료 처리...');
  await hostPage.click('#end-btn-results').catch(() => {});
  await hostPage.waitForTimeout(500);

  await teardown();

  async function teardown() {
    for (const p of players) await p.context.close().catch(() => {});
    await hostContext.close().catch(() => {});
    await browser.close().catch(() => {});
    serverProcess.kill();

    reportLine('\n================ 시뮬레이션 리포트 ================');
    reportLine(`모드: ${args.mode}, 참가자 수: ${args.participants}, chaos: ${args.chaos}`);
    if (args.mode === 'baton') {
      reportLine(`바톤 캔버스 배경 로드 성공(200) 횟수: ${batonContinuationLoads}건 — 게임 진행 중 이어그리기 로드 + 결과 화면 갤러리 열람 로드 합산. 실패(404 등)는 위 anomaly 목록에 별도로 잡힘.`);
    }
    if (anomalies.length === 0) {
      reportLine('이상 없음: 감지된 anomaly가 없습니다.');
    } else {
      reportLine(`감지된 anomaly: ${anomalies.length}건`);
      for (const a of anomalies) reportLine(`  - [${a.source}] ${a.detail}`);
    }
    if (anomalies.length > 0) {
      reportLine('\n--- 서버 로그 (최근 40줄) ---');
      reportLine(serverLines.slice(-40).join(''));
    }
    reportLine('====================================================\n');

    const logFilePath = writeLogFile(args);
    console.log(`전체 로그 저장됨: ${logFilePath}`);

    process.exit(anomalies.length > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('시뮬레이션 실행 중 처리되지 않은 오류:', err);
  process.exit(1);
});
