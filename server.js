const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
let matchQueue = null; // 대기 중인 플레이어 1명

function send(ws, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function createRoom(hostWs, guestWs) {
  const roomId = uuidv4().slice(0, 6).toUpperCase();
  rooms[roomId] = { host: hostWs, guest: guestWs };
  hostWs.roomId = roomId; hostWs.role = 'host';
  guestWs.roomId = roomId; guestWs.role = 'guest';
  send(hostWs, { type: 'game_start', yourRole: 'host' });
  send(guestWs, { type: 'game_start', yourRole: 'guest' });
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── 방 만들기 ──────────────────────────────────
      case 'create_room': {
        const roomId = uuidv4().slice(0, 6).toUpperCase();
        rooms[roomId] = { host: ws, guest: null };
        ws.roomId = roomId; ws.role = 'host';
        send(ws, { type: 'room_created', roomId });
        break;
      }

      // ── 방 입장 ────────────────────────────────────
      case 'join_room': {
        const roomId = msg.roomId?.toUpperCase();
        const room = rooms[roomId];
        if (!room) { send(ws, { type: 'error', message: '존재하지 않는 방입니다.' }); return; }
        if (room.guest) { send(ws, { type: 'error', message: '이미 가득 찬 방입니다.' }); return; }
        room.guest = ws; ws.roomId = roomId; ws.role = 'guest';
        send(room.host, { type: 'game_start', yourRole: 'host' });
        send(room.guest, { type: 'game_start', yourRole: 'guest' });
        break;
      }

      // ── 빠른 매칭 ──────────────────────────────────
      case 'quick_match': {
        ws.queueName = msg.name || 'PLAYER';
        if (matchQueue && matchQueue !== ws && matchQueue.readyState === 1) {
          // 대기자 있음 → 즉시 매칭
          const opponent = matchQueue;
          matchQueue = null;
          createRoom(opponent, ws);
          // 이름 교환
          send(opponent, { type: 'player_name', name: ws.queueName });
          send(ws,       { type: 'player_name', name: opponent.queueName });
        } else {
          // 대기열에 추가
          matchQueue = ws;
          ws.inQueue = true;
          send(ws, { type: 'queue_waiting' });
        }
        break;
      }

      // ── 빠른 매칭 취소 ────────────────────────────
      case 'cancel_queue': {
        if (matchQueue === ws) { matchQueue = null; ws.inQueue = false; }
        break;
      }

      // ── 입력 릴레이 ────────────────────────────────
      case 'input': {
        const room = rooms[ws.roomId];
        if (!room) return;
        send(ws.role === 'host' ? room.guest : room.host, { type: 'opponent_input', keys: msg.keys });
        break;
      }

      // ── 상태 동기화 ────────────────────────────────
      case 'game_state': {
        const room = rooms[ws.roomId];
        if (!room || ws.role !== 'host') return;
        send(room.guest, { type: 'game_state', state: msg.state });
        break;
      }

      // ── 라운드 이벤트 ──────────────────────────────
      case 'round_event': {
        const room = rooms[ws.roomId];
        if (!room) return;
        send(ws.role === 'host' ? room.guest : room.host, { type: 'round_event', event: msg.event });
        break;
      }

      // ── 이름 교환 ──────────────────────────────────
      case 'player_name': {
        const room = rooms[ws.roomId];
        if (!room) return;
        send(ws.role === 'host' ? room.guest : room.host, { type: 'player_name', name: msg.name });
        break;
      }

      // ── 핑 ────────────────────────────────────────
      case 'ping': {
        send(ws, { type: 'pong', t: msg.t });
        break;
      }
    }
  });

  ws.on('close', () => {
    // 대기열에서 제거
    if (matchQueue === ws) matchQueue = null;
    const room = rooms[ws.roomId];
    if (!room) return;
    const other = ws.role === 'host' ? room.guest : room.host;
    send(other, { type: 'opponent_disconnected' });
    delete rooms[ws.roomId];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦗 Mantis Duel server running on port ${PORT}`);
});
