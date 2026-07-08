const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./config');
const network = require('./network');
const createRouter = require('./routes');
const registerSocketHandlers = require('./socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });

app.use(createRouter(io));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'host.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

registerSocketHandlers(io);

server.listen(config.PORT, () => {
  const candidates = network.getLocalIPv4Candidates();
  console.log(`\n얼굴 그리기 아이스브레이커 서버가 시작됐습니다.`);
  console.log(`진행자 화면: http://localhost:${config.PORT}/host`);
  if (candidates.length === 0) {
    console.log(`같은 와이파이가 감지되지 않았습니다. 참가자는 http://localhost:${config.PORT}/ 로 접속하세요 (같은 기기에서만 가능).`);
  } else {
    for (const c of candidates) {
      console.log(`참가자 입장 주소 후보 (${c.name}): http://${c.address}:${config.PORT}/`);
    }
  }
});
