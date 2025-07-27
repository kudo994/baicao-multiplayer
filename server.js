// server logic placeholder
// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const rooms = {};

function shuffleDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push({ suit: s, value: v });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function calcPoint(cards) {
  const toPoint = (val) => {
    if (val === 'J' || val === 'Q' || val === 'K') return 10;
    if (val === 'A') return 1;
    return parseInt(val);
  };
  const total = cards.reduce((sum, c) => sum + toPoint(c.value), 0);
  return total % 10 === 0 ? 0 : total % 10;
}

function checkType(cards) {
  const vals = cards.map(c => c.value);
  const same = vals.every(v => v === vals[0]);
  const valToNum = v => (v === 'A' ? 1 : v === 'J' ? 11 : v === 'Q' ? 12 : v === 'K' ? 13 : parseInt(v));
  const nums = vals.map(valToNum).sort((a, b) => a - b);
  const isLiêng = nums[1] === nums[0] + 1 && nums[2] === nums[1] + 1;
  const isThreeFace = vals.every(v => ['J', 'Q', 'K'].includes(v));

  if (same) return { type: 'Sáp', rank: 5, compare: valToNum(vals[0]) };
  if (isLiêng) return { type: 'Liêng', rank: 4, compare: Math.max(...nums) };
  if (isThreeFace) return { type: 'Ba Tây', rank: 3 };
  if (calcPoint(cards) === 0) return { type: 'Bù', rank: 0 };
  return { type: `Điểm ${calcPoint(cards)}`, rank: 1, compare: calcPoint(cards) };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.compare !== undefined && b.compare !== undefined) return a.compare - b.compare;
  return 0;
}

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  socket.on('login', (username) => {
    socket.username = username;
    socket.emit('logged_in');
  });

  socket.on('create_room', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: {}, deck: [], status: 'waiting' };
    }
    socket.join(roomId);
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: socket.username,
      cards: [],
      nemCount: 0,
      points: 0,
    };
    io.to(roomId).emit('room_update', Object.values(rooms[roomId].players));
  });

  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.deck = shuffleDeck();
    room.status = 'playing';
    Object.values(room.players).forEach((player) => {
      player.cards = room.deck.splice(0, 3);
      player.nemCount = 0;
    });
    io.to(roomId).emit('game_started', room.players);

    // Tự động kết thúc ván sau 60 giây
    setTimeout(() => {
      const results = Object.values(room.players).map(p => ({
        id: p.id,
        name: p.name,
        hand: p.cards,
        type: checkType(p.cards)
      }));

      results.sort((a, b) => compareHands(b.type, a.type));
      const winner = results[0];
      io.to(roomId).emit('round_result', { results, winner });
    }, 60000);
  });

  socket.on('request_nem', ({ roomId, cardIndex }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (player.nemCount >= 3) return;

    player.nemRequest = { index: cardIndex };
    io.to(roomId).emit('nem_offer', { from: socket.id, name: player.name });
  });

  socket.on('accept_nem', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const fromPlayer = room.players[targetId];
    const toPlayer = room.players[socket.id];
    if (!fromPlayer || !fromPlayer.nemRequest) return;

    const fromIndex = fromPlayer.nemRequest.index;
    const toIndex = Math.floor(Math.random() * 3);

    // Swap cards
    const temp = fromPlayer.cards[fromIndex];
    fromPlayer.cards[fromIndex] = toPlayer.cards[toIndex];
    toPlayer.cards[toIndex] = temp;

    fromPlayer.nemCount += 1;

    delete fromPlayer.nemRequest;

    io.to(roomId).emit('nem_success', {
      from: fromPlayer.name,
      to: toPlayer.name
    });

    // Cập nhật lại bài cho 2 người
    io.to(fromPlayer.id).emit('your_cards', fromPlayer.cards);
    io.to(toPlayer.id).emit('your_cards', toPlayer.cards);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomId).emit('room_update', Object.values(room.players));
        if (Object.keys(room.players).length === 0) delete rooms[roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
