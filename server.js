const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
 
app.use(express.static(path.join(__dirname, 'public')));
 
// ==================== UNO GAME LOGIC ====================
 
const COLORS = ['red', 'green', 'blue', 'yellow'];
const SPECIAL_CARDS = ['skip', 'reverse', 'draw2'];
 
const BOT_NAMES = ['🤖 Zamin', '🦾 Robotcha', '👾 Kibor', '🧠 AIBot'];
const BOT_COMMENTS = {
  play:    ['Zo\'r karta!', 'Ha-ha!', 'Mana bu!', 'Oldinga!', 'Hmmm...'],
  draw:    ['Karta olaman...', 'Menga yaxshisi yo\'q...', 'Olaman!'],
  uno:     ['UNO!!!', 'Yaqinlashyapman!', 'UNO, do\'stlar!'],
  win:     ['G\'oldim! 🏆', 'Men eng yaxshiman!', 'Haha, yutdim!'],
  taunt:   ['Kuchsizlar!', 'Menga to\'siq bo\'lolmaysiz!', 'Keyingi navbat meniki!']
};
 
function createDeck() {
  const deck = [];
  COLORS.forEach(color => {
    deck.push({ color, value: '0', type: 'number' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: String(i), type: 'number' });
      deck.push({ color, value: String(i), type: 'number' });
    }
    SPECIAL_CARDS.forEach(sp => {
      deck.push({ color, value: sp, type: 'special' });
      deck.push({ color, value: sp, type: 'special' });
    });
  });
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild', type: 'wild' });
    deck.push({ color: 'wild', value: 'wild4', type: 'wild4' });
  }
  return deck;
}
 
function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
 
function canPlay(card, topCard, currentColor, mustDraw) {
  if (mustDraw) return card.value === 'draw2' || card.value === 'wild4';
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}
 
// ==================== ROOM MANAGEMENT ====================
 
const rooms = {};
 
function getRoom(roomId) { return rooms[roomId]; }
 
function getRoomList() {
  return Object.values(rooms)
    .filter(r => r.gameState === 'waiting' && r.privacy === 'open' && r.players.length < r.maxPlayers)
    .map(r => ({
      id: r.id,
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers,
      host: r.players.find(p => p.id === r.host)?.name || 'Unknown'
    }));
}
 
function drawCards(room, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) {
      const top = room.discardPile.pop();
      room.deck = shuffleDeck(room.discardPile);
      room.discardPile = [top];
    }
    if (room.deck.length > 0) drawn.push(room.deck.shift());
  }
  return drawn;
}
 
function nextPlayer(room) {
  const count = room.players.length;
  room.currentPlayerIndex = ((room.currentPlayerIndex + room.direction) % count + count) % count;
  startTurnTimer(room);
}
 
function startTurnTimer(room) {
  if (room.gameState !== 'playing') return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnStartTime = Date.now();
  room.turnDuration = 15000;
  
  room.turnTimer = setTimeout(() => {
    if (room.gameState !== 'playing') return;
    const r = getRoom(room.id);
    if (!r) return;
    const currentPlayer = r.players[r.currentPlayerIndex];
    if (currentPlayer && !currentPlayer.isBot) {
      applyDrawCard(r, r.currentPlayerIndex);
      broadcastState(r);
      scheduleNextBotTurn(r);
    }
  }, room.turnDuration);
}
 
function getTopCard(room) {
  return room.discardPile[room.discardPile.length - 1];
}
 
// TUZATILGAN: buildGameState to'liq mos keladigan formatda
function buildGameState(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return null;
  
  const topCard = getTopCard(room);
  const winnerPlayer = room.winner ? room.players.find(p => p.id === room.winner) : null;
  
  return {
    roomId: room.id,
    gameState: room.gameState,
    privacy: room.privacy,
    maxPlayers: room.maxPlayers,
    currentColor: room.currentColor,
    direction: room.direction,
    deckCount: room.deck.length,
    mustDraw: room.mustDraw,
    turnStartTime: room.turnStartTime,
    turnDuration: room.turnDuration,
    topCard: topCard,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id,
    winner: winnerPlayer ? { id: winnerPlayer.id, name: winnerPlayer.name, isBot: winnerPlayer.isBot } : null,
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length,
      hand: p.id === playerId ? p.hand : [],
      isBot: p.isBot || false,
      isCurrentPlayer: i === room.currentPlayerIndex,
      isMe: p.id === playerId,
      saidUno: p.saidUno || false
    }))
  };
}
 
function broadcastState(room) {
  room.players.filter(p => !p.isBot).forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('gameUpdate', buildGameState(room, p.id));
  });
}
 
// ==================== PLAY CARD ====================
 
function applyPlayCard(room, playerIndex, cardIndex, chosenColor) {
  const player = room.players[playerIndex];
  const card = player.hand[cardIndex];
 
  player.hand.splice(cardIndex, 1);
  player.saidUno = false;
  room.discardPile.push(card);
 
  if (card.type === 'wild' || card.type === 'wild4') {
    room.currentColor = chosenColor || 'red';
  } else {
    room.currentColor = card.color;
  }
 
  if (player.hand.length === 0) {
    room.gameState = 'finished';
    room.winner = player.id;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    return { won: true };
  }
 
  if (card.value === 'skip') {
    nextPlayer(room);
    nextPlayer(room);
  } else if (card.value === 'reverse') {
    room.direction *= -1;
    if (room.players.length !== 2) {
      nextPlayer(room);
    }
  } else if (card.value === 'draw2') {
    nextPlayer(room);
    room.pendingDraw += 2;
    room.mustDraw = true;
  } else if (card.value === 'wild4') {
    nextPlayer(room);
    room.pendingDraw += 4;
    room.mustDraw = true;
  } else {
    nextPlayer(room);
  }
 
  return null;
}
 
function applyDrawCard(room, playerIndex) {
  const player = room.players[playerIndex];
  let drawCount = 1;
 
  if (room.pendingDraw > 0) {
    drawCount = room.pendingDraw;
    room.pendingDraw = 0;
    room.mustDraw = false;
  }
  const drawn = drawCards(room, drawCount);
  player.hand.push(...drawn);
  player.saidUno = false;
 
  io.to(room.id).emit('chatMessage', { type: 'system', message: `🃏 ${player.name} ${drawCount} ta karta oldi.` });
 
  nextPlayer(room);
}
 
// ==================== BOT AI ====================
 
function getBotRandomComment(type) {
  const arr = BOT_COMMENTS[type];
  return arr[Math.floor(Math.random() * arr.length)];
}
 
function chooseBestColor(hand) {
  const counts = { red: 0, green: 0, blue: 0, yellow: 0 };
  hand.forEach(c => {
    if (counts[c.color] !== undefined) counts[c.color]++;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
 
function botChooseCard(hand, topCard, currentColor, mustDraw) {
  const playable = hand.map((card, i) => ({ card, i }))
    .filter(({ card }) => canPlay(card, topCard, currentColor, mustDraw));
 
  if (playable.length === 0) return null;
 
  const priority = (card) => {
    if (card.value === 'wild4') return 7;
    if (card.value === 'draw2') return 6;
    if (card.value === 'skip') return 5;
    if (card.value === 'reverse') return 4;
    if (card.color === currentColor) return 3;
    if (card.value === 'wild') return 2;
    return 1;
  };
 
  playable.sort((a, b) => {
    const diff = priority(b.card) - priority(a.card);
    return diff !== 0 ? diff : Math.random() - 0.5;
  });
 
  return playable[0];
}
 
function botTakeTurn(room, botIndex) {
  const bot = room.players[botIndex];
  if (!bot || !bot.isBot) return;
  if (room.currentPlayerIndex !== botIndex) return;
  if (room.gameState !== 'playing') return;
 
  const topCard = getTopCard(room);
  const chosen = botChooseCard(bot.hand, topCard, room.currentColor, room.mustDraw);
 
  if (!chosen) {
    applyDrawCard(room, botIndex);
    broadcastState(room);
    io.to(room.id).emit('cardPlayed', { playerName: bot.name, card: null, botDrew: true });
    scheduleNextBotTurn(room);
    return;
  }
 
  let chosenColor = null;
  if (chosen.card.type === 'wild' || chosen.card.type === 'wild4') {
    chosenColor = chooseBestColor(bot.hand);
  }
 
  if (bot.hand.length === 2) {
    bot.saidUno = true;
    setTimeout(() => {
      io.to(room.id).emit('chatMessage', { type: 'uno', message: `🎴 ${bot.name}: UNO!!!` });
    }, 200);
  }
 
  const result = applyPlayCard(room, botIndex, chosen.i, chosenColor);
 
  if (Math.random() < 0.3) {
    const comment = getBotRandomComment('play');
    setTimeout(() => {
      io.to(room.id).emit('chatMessage', { type: 'player', playerName: bot.name, message: comment });
    }, 300);
  }
 
  io.to(room.id).emit('cardPlayed', { playerName: bot.name, card: chosen.card });
 
  if (result && result.won) {
    broadcastState(room);
    io.to(room.id).emit('chatMessage', { type: 'system', message: `🏆 ${bot.name} g'olib bo'ldi!` });
    return;
  }
 
  broadcastState(room);
  scheduleNextBotTurn(room);
}
 
function scheduleNextBotTurn(room) {
  if (room.gameState !== 'playing') return;
  const currentPlayer = room.players[room.currentPlayerIndex];
  if (currentPlayer && currentPlayer.isBot) {
    const delay = 1000 + Math.random() * 1200;
    setTimeout(() => {
      const r = getRoom(room.id);
      if (!r || r.gameState !== 'playing') return;
      botTakeTurn(r, r.currentPlayerIndex);
    }, delay);
  }
}
 
// ==================== GAME START ====================
 
function startGame(room) {
  room.deck = shuffleDeck(createDeck());
  room.gameState = 'playing';
  room.direction = 1;
  room.pendingDraw = 0;
  room.mustDraw = false;
  room.winner = null;
 
  room.players.forEach(player => {
    player.hand = room.deck.splice(0, 7);
    player.saidUno = false;
  });
 
  let firstCard;
  do {
    firstCard = room.deck.shift();
    if (firstCard.type === 'wild' || firstCard.type === 'wild4') {
      room.deck.push(firstCard);
    }
  } while (firstCard.type === 'wild' || firstCard.type === 'wild4');
 
  room.discardPile = [firstCard];
  
  for (let i = 0; i < 3; i++) {
    if (room.deck.length > 0) {
      room.discardPile.push(room.deck.shift());
    }
  }
 
  room.currentColor = firstCard.color;
  room.currentPlayerIndex = 0;
  
  startTurnTimer(room);
  scheduleNextBotTurn(room);
}
 
// ==================== SOCKET.IO ====================
 
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
 
  socket.on('createRoom', ({ playerName, privacy, maxPlayers }) => {
    const roomId = Math.random().toString(36).substr(2, 9).toUpperCase();
    
    rooms[roomId] = {
      id: roomId, host: socket.id, players: [],
      deck: [], discardPile: [], currentPlayerIndex: 0,
      direction: 1, currentColor: null, gameState: 'waiting',
      pendingDraw: 0, mustDraw: false, winner: null,
      privacy: privacy || 'open',
      maxPlayers: maxPlayers || 8
    };
    const room = rooms[roomId];
    room.players.push({ id: socket.id, name: playerName, hand: [], saidUno: false, isBot: false });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = playerName;
 
    socket.emit('roomCreated', { roomId });
    socket.emit('gameUpdate', buildGameState(room, socket.id));
    io.emit('roomListUpdate', getRoomList());
    console.log(`Room ${roomId} created by ${playerName}`);
  });
 
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = getRoom(roomId);
    if (!room) return socket.emit('error', { message: 'Xona topilmadi!' });
    if (room.gameState !== 'waiting') return socket.emit('error', { message: 'O\'yin boshlangan!' });
    if (room.players.length >= room.maxPlayers) return socket.emit('error', { message: `Xona to\'lgan! (maks ${room.maxPlayers})` });
 
    room.players.push({ id: socket.id, name: playerName, hand: [], saidUno: false, isBot: false });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = playerName;
 
    broadcastState(room);
    io.to(roomId).emit('chatMessage', { type: 'system', message: `${playerName} xonaga qo'shildi!` });
    io.emit('roomListUpdate', getRoomList());
  });
 
  socket.on('setRoomPrivacy', ({ privacy }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { message: 'Faqat host privacy o\'zgartirishga ruxsat!' });
    
    room.privacy = privacy;
    io.to(socket.roomId).emit('chatMessage', { 
      type: 'system', 
      message: `🔒 Xona ${privacy === 'open' ? 'Ochiq' : 'Yopiq'} qilingan!` 
    });
    broadcastState(room);
    io.emit('roomListUpdate', getRoomList());
  });
 
  socket.on('addBot', ({ difficulty }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { message: 'Faqat host bot qo\'sha oladi!' });
    if (room.gameState !== 'waiting') return socket.emit('error', { message: 'O\'yin boshlangan!' });
    if (room.players.length >= room.maxPlayers) return socket.emit('error', { message: `Xona to\'lgan! (maks ${room.maxPlayers})` });
 
    const botCount = room.players.filter(p => p.isBot).length;
    const botName = BOT_NAMES[botCount % BOT_NAMES.length];
    const botId = `BOT_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
 
    room.players.push({
      id: botId,
      name: botName,
      hand: [],
      saidUno: false,
      isBot: true,
      difficulty: difficulty || 'medium'
    });
 
    broadcastState(room);
    io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `🤖 ${botName} xonaga qo'shildi!` });
    io.emit('roomListUpdate', getRoomList());
  });
 
  socket.on('removeBot', ({ botId }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (room.host !== socket.id) return;
    if (room.gameState !== 'waiting') return;
 
    const bot = room.players.find(p => p.id === botId && p.isBot);
    if (!bot) return;
 
    room.players = room.players.filter(p => p.id !== botId);
    broadcastState(room);
    io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `🤖 ${bot.name} xonadan chiqarildi.` });
    io.emit('roomListUpdate', getRoomList());
  });
 
  socket.on('getRoomList', () => socket.emit('roomListUpdate', getRoomList()));
 
  socket.on('startGame', () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { message: 'Faqat host boshlashi mumkin!' });
    if (room.players.filter(p => !p.isBot).length < 1) return socket.emit('error', { message: 'Kamida 1 haqiqiy o\'yinchi kerak!' });
 
    startGame(room);
    broadcastState(room);
    io.to(socket.roomId).emit('gameStarted');
    io.to(socket.roomId).emit('chatMessage', { type: 'system', message: '🎮 O\'yin boshlandi! Yaxshi o\'yin!' });
    io.emit('roomListUpdate', getRoomList());
 
    scheduleNextBotTurn(room);
  });
 
  socket.on('playCard', ({ cardIndex, chosenColor }) => {
    const room = getRoom(socket.roomId);
    if (!room || room.gameState !== 'playing') return;
 
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    const isCurrentPlayer = (room.players[room.currentPlayerIndex].id === socket.id);
    const card = player.hand[cardIndex];
    if (!card) return socket.emit('error', { message: 'Karta topilmadi!' });
    
    const topCard = getTopCard(room);
    
    // Jump-In logic: exact match of color and value (not wild)
    const isJumpIn = (!isCurrentPlayer && card.type !== 'wild' && card.type !== 'wild4' && card.color === topCard.color && card.value === topCard.value);
    
    if (!isCurrentPlayer && !isJumpIn) {
      return socket.emit('error', { message: 'Siz navbatda emassiz!' });
    }
    
    if (isCurrentPlayer && !canPlay(card, topCard, room.currentColor, room.mustDraw)) {
      return socket.emit('error', { message: 'Bu kartani o\'ynab bo\'lmaydi!' });
    }
    
    if (isJumpIn && room.mustDraw) {
      return socket.emit('error', { message: 'Jazo kartasi ustida Jump-In qilib bo\'lmaydi!' });
    }
    
    if (isJumpIn) {
      room.currentPlayerIndex = room.players.indexOf(player);
      io.to(room.id).emit('chatMessage', { type: 'system', message: `⚡ ${player.name} JUMP-IN qildi!` });
    }
 
    const result = applyPlayCard(room, room.currentPlayerIndex, cardIndex, chosenColor);
 
    io.to(socket.roomId).emit('cardPlayed', { playerName: currentPlayer.name, card });
 
    if (result && result.won) {
      broadcastState(room);
      io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `🏆 ${currentPlayer.name} g'olib bo'ldi!` });
      io.emit('roomListUpdate', getRoomList());
      return;
    }
 
    broadcastState(room);
    scheduleNextBotTurn(room);
  });
 
  socket.on('drawCard', () => {
    const room = getRoom(socket.roomId);
    if (!room || room.gameState !== 'playing') return;
 
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      return socket.emit('error', { message: 'Siz navbatda emassiz!' });
    }
 
    applyDrawCard(room, room.currentPlayerIndex);
    broadcastState(room);
    scheduleNextBotTurn(room);
  });
 
  socket.on('sayUno', () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && player.hand.length <= 2) {
      player.saidUno = true;
      io.to(socket.roomId).emit('chatMessage', { type: 'uno', message: `🎴 ${player.name} UNO dedi!` });
      broadcastState(room);
    }
  });
 
  socket.on('catchUno', ({ targetId }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const target = room.players.find(p => p.id === targetId);
    if (target && target.hand.length === 1 && !target.saidUno) {
      const drawn = drawCards(room, 2);
      target.hand.push(...drawn);
      io.to(socket.roomId).emit('chatMessage', {
        type: 'system',
        message: `😱 ${target.name} UNO demaganida ushlandi! +2 karta!`
      });
      broadcastState(room);
    }
  });
 
  // TUZATILGAN: sendChat emas, chat event ishlatiladi
  socket.on('chat', ({ message }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(socket.roomId).emit('chatMessage', { type: 'player', playerName: player.name, message });
    }
  });
  
  socket.on('reaction', ({ emoji }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    io.to(socket.roomId).emit('reaction', { playerId: socket.id, emoji });
  });
  
  // Eski clientlar uchun sendChat ni ham qo'llab-quvvatlash
  socket.on('sendChat', ({ message }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(socket.roomId).emit('chatMessage', { type: 'player', playerName: player.name, message });
    }
  });
 
  socket.on('leaveRoom', () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
 
    room.players = room.players.filter(p => p.id !== socket.id);
 
    if (room.players.length === 0) {
      delete rooms[socket.roomId];
      console.log(`Room ${socket.roomId} deleted`);
    } else {
      if (room.host === socket.id) {
        const newHost = room.players.find(p => !p.isBot) || room.players[0];
        if (newHost) room.host = newHost.id;
      }
      broadcastState(room);
      io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `Bir o'yinchi xonadan chiqdi.` });
    }
 
    io.emit('roomListUpdate', getRoomList());
  });
 
  socket.on('disconnect', () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
 
    room.players = room.players.filter(p => p.id !== socket.id);
 
    if (room.players.length === 0) {
      delete rooms[socket.roomId];
      console.log(`Room ${socket.roomId} deleted`);
    } else {
      if (room.host === socket.id) {
        const newHost = room.players.find(p => !p.isBot) || room.players[0];
        if (newHost) room.host = newHost.id;
      }
      broadcastState(room);
    }
 
    io.emit('roomListUpdate', getRoomList());
  });
});
 
// ==================== SERVER ====================
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 UNO server running on port ${PORT}`));