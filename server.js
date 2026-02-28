const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// 방 목록: { roomId: { host: ws, guest: ws|null, state: {...} } }
const rooms = {};

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomId = null;
  ws.role = null; // 'host' | 'guest'

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── 방 만들기 ──────────────────────────────────────────
      case 'create_room': {
        const roomId = uuidv4().slice(0, 6).toUpperCase();
        rooms[roomId] = { host: ws, guest: null };
        ws.roomId = roomId;
        ws.role = 'host';
        send(ws, { type: 'room_created', roomId });
        break;
      }

      // ── 방 입장 ────────────────────────────────────────────
      case 'join_room': {
        const roomId = msg.roomId?.toUpperCase();
        const room = rooms[roomId];
        if (!room) {
          send(ws, { type: 'error', message: '존재하지 않는 방입니다.' });
          return;
        }
        if (room.guest) {
          send(ws, { type: 'error', message: '이미 가득 찬 방입니다.' });
          return;
        }
        room.guest = ws;
        ws.roomId = roomId;
        ws.role = 'guest';
        // 둘 다 입장 완료 → 게임 시작 알림
        send(room.host, { type: 'game_start', yourRole: 'host' });
        send(room.guest, { type: 'game_start', yourRole: 'guest' });
        break;
      }

      // ── 입력 전송 (host→guest, guest→host 릴레이) ──────────
      case 'input': {
        const room = rooms[ws.roomId];
        if (!room) return;
        const target = ws.role === 'host' ? room.guest : room.host;
        send(target, { type: 'opponent_input', keys: msg.keys });
        break;
      }

      // ── 게임 상태 동기화 (host가 매 프레임 전송) ──────────
      case 'game_state': {
        const room = rooms[ws.roomId];
        if (!room || ws.role !== 'host') return;
        send(room.guest, { type: 'game_state', state: msg.state });
        break;
      }

      // ── 라운드/이벤트 동기화 ──────────────────────────────
      case 'round_event': {
        const room = rooms[ws.roomId];
        if (!room) return;
        const target = ws.role === 'host' ? room.guest : room.host;
        send(target, { type: 'round_event', event: msg.event });
        break;
      }

      // ── 핑 ────────────────────────────────────────────────
      case 'ping': {
        send(ws, { type: 'pong', t: msg.t });
        break;
      }

      // ── 이름 교환 ──────────────────────────────────────────
      case 'player_name': {
        const room = rooms[ws.roomId];
        if (!room) return;
        const target = ws.role === 'host' ? room.guest : room.host;
        send(target, { type: 'player_name', name: msg.name });
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (!room) return;
    // 상대방에게 연결 끊김 알림
    const other = ws.role === 'host' ? room.guest : room.host;
    send(other, { type: 'opponent_disconnected' });
    delete rooms[ws.roomId];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦗 Mantis Duel server running on port ${PORT}`);
});
