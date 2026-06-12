const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Security middleware
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ==================== IN-MEMORY STORAGE ====================
const users = new Map();
const sessions = new Map();
const userStats = new Map();
let nextUserId = 1;

const ACHIEVEMENTS = [
  { id: 1, name: 'Birinchi g\'alaba', description: 'Birinchi marta g\'alaba qozonish', icon: '🏆', required_wins: 1 },
  { id: 2, name: 'UNO Ustasi', description: '5 marta g\'alaba qozonish', icon: '🎯', required_wins: 5 },
  { id: 3, name: 'UNO Legend', description: '10 marta g\'alaba qozonish', icon: '👑', required_wins: 10 },
  { id: 4, name: 'Tajribali o\'yinchi', description: '20 ta o\'yin o\'ynash', icon: '🎮', required_games: 20 },
  { id: 5, name: 'UNO Mutaxassisi', description: '10 marta UNO deyish', icon: '🔊', required_uno: 10 },
];

const DEFAULT_AVATARS = [
  '/avatars/default1.svg', '/avatars/default2.svg', 
  '/avatars/default3.svg', '/avatars/default4.svg'
];

function getUserByUsername(username) {
  for (const [id, user] of users) {
    if (user.username === username) return { ...user, id: parseInt(id) };
  }
  return null;
}

function getUserById(id) {
  const user = users.get(id.toString());
  if (!user) return null;
  const stats = userStats.get(id.toString()) || { wins: 0, losses: 0, games_played: 0, total_points: 0, uno_count: 0, catch_uno_count: 0 };
  return { ...user, ...stats, id: parseInt(id) };
}

function createUser(username, passwordHash, displayName, avatarUrl) {
  const userId = (nextUserId++).toString();
  users.set(userId, {
    username,
    password_hash: passwordHash,
    display_name: displayName,
    avatar_url: avatarUrl,
    created_at: new Date().toISOString(),
    last_login: new Date().toISOString()
  });
  userStats.set(userId, { wins: 0, losses: 0, games_played: 0, total_points: 0, uno_count: 0, catch_uno_count: 0 });
  return parseInt(userId);
}

function updateUserStats(userId, won, points, unoCalled, catchUno) {
  const stats = userStats.get(userId.toString()) || { wins: 0, losses: 0, games_played: 0, total_points: 0, uno_count: 0, catch_uno_count: 0 };
  
  if (won) stats.wins++;
  else stats.losses++;
  
  stats.games_played++;
  stats.total_points += points;
  if (unoCalled) stats.uno_count++;
  if (catchUno) stats.catch_uno_count++;
  
  userStats.set(userId.toString(), stats);
  
  // Check achievements
  const userAchievements = globalUserAchievements.get(userId.toString()) || [];
  for (const ach of ACHIEVEMENTS) {
    if (!userAchievements.find(a => a.id === ach.id)) {
      let earned = false;
      if (ach.required_wins > 0 && stats.wins >= ach.required_wins) earned = true;
      if (ach.required_games > 0 && stats.games_played >= ach.required_games) earned = true;
      if (ach.required_uno > 0 && stats.uno_count >= ach.required_uno) earned = true;
      
      if (earned) {
        userAchievements.push({ ...ach, earned_at: new Date().toISOString() });
      }
    }
  }
  globalUserAchievements.set(userId.toString(), userAchievements);
}

function createSession(userId, token, ip, userAgent) {
  sessions.set(token, { userId: userId.toString(), expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), ip, userAgent });
  return token;
}

function getSessionUser(sessionToken) {
  const session = sessions.get(sessionToken);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    sessions.delete(sessionToken);
    return null;
  }
  return getUserById(session.userId);
}

function deleteSession(sessionToken) {
  sessions.delete(sessionToken);
}

function getLeaderboard(limit = 10) {
  const stats = [];
  for (const [id, user] of users) {
    const userStat = userStats.get(id) || { wins: 0, games_played: 0, total_points: 0 };
    stats.push({
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      wins: userStat.wins,
      games_played: userStat.games_played,
      total_points: userStat.total_points
    });
  }
  return stats.sort((a, b) => b.wins - a.wins || b.total_points - a.total_points).slice(0, limit);
}

function getUserAchievements(userId) {
  return globalUserAchievements.get(userId.toString()) || [];
}

const globalUserAchievements = new Map();

// ==================== UNO GAME LOGIC ====================
const COLORS = ['red', 'green', 'blue', 'yellow'];
const SPECIAL_CARDS = ['skip', 'reverse', 'draw2'];
const BOT_NAMES = ['🤖 Zamin', '🦾 Robotcha', '👾 Kibor', '🧠 AIBot', '🤖 Botbek', '🦿 Terminator', '👽 Alien', '🧠 SmartBot'];
const BOT_COMMENTS = {
  play: ['Zo\'r karta!', 'Ha-ha!', 'Mana bu!', 'Oldinga!', 'Hmmm...', 'Ajoyib!', 'Bunday bo\'lishi kerak!', 'Ko\'ring!'],
  draw: ['Karta olaman...', 'Menga yaxshisi yo\'q...', 'Olaman!', 'Omad kerak!', 'Qani ketdi!'],
  uno: ['UNO!!!', 'Yaqinlashyapman!', 'UNO, do\'stlar!', 'Diqqat!', 'Faqat bir karta qoldi!'],
  win: ['G\'oldim! 🏆', 'Men eng yaxshiman!', 'Haha, yutdim!', 'Mag\'lubiyatni tan oling!', 'Yana bir bor!'],
  taunt: ['Kuchsizlar!', 'Menga to\'siq bo\'lolmaysiz!', 'Keyingi navbat meniki!', 'Qo\'rqyapsizmi?', 'Harakat qilib ko\'ring!']
};

function createDeck() {
  const deck = [];
  COLORS.forEach(color => {
    deck.push({ color, value: '0', type: 'number', points: 0 });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: String(i), type: 'number', points: i });
      deck.push({ color, value: String(i), type: 'number', points: i });
    }
    SPECIAL_CARDS.forEach(sp => {
      const points = sp === 'draw2' ? 20 : 20;
      deck.push({ color, value: sp, type: 'special', points: points });
      deck.push({ color, value: sp, type: 'special', points: points });
    });
  });
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild', type: 'wild', points: 50 });
    deck.push({ color: 'wild', value: 'wild4', type: 'wild4', points: 50 });
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

function calculatePoints(hand) {
  return hand.reduce((sum, card) => sum + (card.points || 0), 0);
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
      host: r.players.find(p => p.id === r.host)?.name || 'Unknown',
      hasPassword: !!r.password
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
  let nextIndex = room.currentPlayerIndex;
  do {
    nextIndex = ((nextIndex + room.direction) % count + count) % count;
  } while (room.players[nextIndex]?.skipTurn);
  
  room.currentPlayerIndex = nextIndex;
  
  room.players.forEach(p => { if (p.skipTurn) p.skipTurn = false; });
  startTurnTimer(room);
}

function startTurnTimer(room) {
  if (room.gameState !== 'playing') return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnStartTime = Date.now();
  room.turnDuration = 20000;
  
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
    pendingDraw: room.pendingDraw || 0,
    turnStartTime: room.turnStartTime,
    turnDuration: room.turnDuration,
    topCard: topCard,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id,
    winner: winnerPlayer ? { id: winnerPlayer.id, name: winnerPlayer.name, isBot: winnerPlayer.isBot } : null,
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName || p.name,
      avatar: p.avatar || '/avatars/default1.svg',
      cardCount: p.hand.length,
      points: calculatePoints(p.hand),
      hand: p.id === playerId ? p.hand : [],
      isBot: p.isBot || false,
      isCurrentPlayer: i === room.currentPlayerIndex,
      isMe: p.id === playerId,
      saidUno: p.saidUno || false,
      skipTurn: p.skipTurn || false
    }))
  };
}

function broadcastState(room) {
  room.players.filter(p => !p.isBot).forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s && s.connected) s.emit('gameUpdate', buildGameState(room, p.id));
  });
}

function applyPlayCard(room, playerIndex, cardIndex, chosenColor) {
  const player = room.players[playerIndex];
  const card = player.hand[cardIndex];
  if (!card) return null;

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
    return { won: true, points: calculatePoints(room.players.reduce((sum, p) => sum + calculatePoints(p.hand), 0)) };
  }

  if (card.value === 'skip') {
    const nextIdx = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
    if (room.players[nextIdx] && !room.players[nextIdx].isBot) {
      room.players[nextIdx].skipTurn = true;
    }
    nextPlayer(room);
  } else if (card.value === 'reverse') {
    room.direction *= -1;
    if (room.players.length !== 2) {
      nextPlayer(room);
    }
  } else if (card.value === 'draw2') {
    nextPlayer(room);
    room.pendingDraw = (room.pendingDraw || 0) + 2;
    room.mustDraw = true;
  } else if (card.value === 'wild4') {
    nextPlayer(room);
    room.pendingDraw = (room.pendingDraw || 0) + 4;
    room.mustDraw = true;
  } else {
    nextPlayer(room);
  }

  return null;
}

function applyDrawCard(room, playerIndex) {
  const player = room.players[playerIndex];
  let drawCount = 1;

  if (room.pendingDraw && room.pendingDraw > 0) {
    drawCount = room.pendingDraw;
    room.pendingDraw = 0;
    room.mustDraw = false;
  }
  const drawn = drawCards(room, drawCount);
  player.hand.push(...drawn);
  player.saidUno = false;
  player.skipTurn = false;

  io.to(room.id).emit('chatMessage', { type: 'system', message: `🃏 ${player.name} ${drawCount} ta karta oldi.` });
  nextPlayer(room);
}

function chooseBestColor(hand) {
  const counts = { red: 0, green: 0, blue: 0, yellow: 0 };
  hand.forEach(c => {
    if (counts[c.color] !== undefined) counts[c.color]++;
  });
  const entries = Object.entries(counts);
  if (entries.length === 0) return 'red';
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function botChooseCard(hand, topCard, currentColor, mustDraw, difficulty = 'medium') {
  const playable = hand.map((card, i) => ({ card, i }))
    .filter(({ card }) => canPlay(card, topCard, currentColor, mustDraw));

  if (playable.length === 0) return null;

  let priority = (card) => {
    if (card.value === 'wild4') return 7;
    if (card.value === 'draw2') return 6;
    if (card.value === 'skip') return 5;
    if (card.value === 'reverse') return 4;
    if (card.color === currentColor) return 3;
    if (card.value === 'wild') return 2;
    return 1;
  };

  if (difficulty === 'easy') {
    return playable[Math.floor(Math.random() * playable.length)];
  } else if (difficulty === 'hard') {
    priority = (card) => {
      if (card.value === 'wild4') return 8;
      if (card.value === 'draw2') return 7;
      if (card.value === 'skip') return 6;
      if (card.value === 'reverse') return 5;
      if (card.value === 'wild') return 4;
      if (card.color === currentColor) return 3;
      return 1;
    };
  }

  playable.sort((a, b) => priority(b.card) - priority(a.card));
  return playable[0];
}

function botTakeTurn(room, botIndex) {
  const bot = room.players[botIndex];
  if (!bot || !bot.isBot) return;
  if (room.currentPlayerIndex !== botIndex) return;
  if (room.gameState !== 'playing') return;

  const topCard = getTopCard(room);
  const chosen = botChooseCard(bot.hand, topCard, room.currentColor, room.mustDraw, bot.difficulty);

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
  io.to(room.id).emit('cardPlayed', { playerName: bot.name, card: chosen.card });

  if (Math.random() < 0.2) {
    const comment = BOT_COMMENTS.play[Math.floor(Math.random() * BOT_COMMENTS.play.length)];
    setTimeout(() => {
      io.to(room.id).emit('chatMessage', { type: 'player', playerName: bot.name, message: comment });
    }, 300);
  }

  if (result && result.won) {
    broadcastState(room);
    io.to(room.id).emit('chatMessage', { type: 'system', message: `🏆 ${bot.name} g'olib bo'ldi! (${result.points} ball)` });
    return;
  }

  broadcastState(room);
  scheduleNextBotTurn(room);
}

function scheduleNextBotTurn(room) {
  if (room.gameState !== 'playing') return;
  const currentPlayer = room.players[room.currentPlayerIndex];
  if (currentPlayer && currentPlayer.isBot) {
    const delay = 800 + Math.random() * 700;
    setTimeout(() => {
      const r = getRoom(room.id);
      if (r && r.gameState === 'playing') {
        botTakeTurn(r, r.currentPlayerIndex);
      }
    }, delay);
  }
}

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
    player.skipTurn = false;
  });

  let firstCard;
  do {
    firstCard = room.deck.shift();
    if (firstCard.type === 'wild' || firstCard.type === 'wild4') {
      room.deck.push(firstCard);
    }
  } while (firstCard.type === 'wild' || firstCard.type === 'wild4');

  room.discardPile = [firstCard];
  room.currentColor = firstCard.color;
  room.currentPlayerIndex = 0;
  
  startTurnTimer(room);
  scheduleNextBotTurn(room);
}

// ==================== AUTH ROUTES ====================
app.post('/api/register', async (req, res) => {
  const { username, password, displayName, avatar } = req.body;
  
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring!' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username 3-20 belgi orasida bo\'lishi kerak!' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username faqat harf, raqam va _ dan iborat bo\'lishi kerak!' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Parol kamida 4 belgi bo\'lishi kerak!' });
  }
  
  try {
    const existingUser = getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Bu username band!' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const avatarUrl = avatar || DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
    
    const userId = createUser(username, passwordHash, displayName, avatarUrl);
    const sessionToken = crypto.randomBytes(32).toString('hex');
    createSession(userId, sessionToken, req.ip, req.headers['user-agent']);
    
    const user = getUserById(userId);
    
    res.json({ 
      success: true, 
      sessionToken, 
      user: { 
        username: user.username, 
        displayName: user.display_name, 
        avatar: user.avatar_url, 
        stats: {
          wins: user.wins || 0,
          gamesPlayed: user.games_played || 0,
          points: user.total_points || 0,
          unoCount: user.uno_count || 0
        }
      } 
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username va parolni kiriting!' });
  }
  
  try {
    const user = getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Noto\'g\'ri username yoki parol!' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Noto\'g\'ri username yoki parol!' });
    }
    
    const sessionToken = crypto.randomBytes(32).toString('hex');
    createSession(user.id, sessionToken, req.ip, req.headers['user-agent']);
    
    const userWithStats = getUserById(user.id);
    
    res.json({ 
      success: true, 
      sessionToken, 
      user: { 
        username: userWithStats.username, 
        displayName: userWithStats.display_name, 
        avatar: userWithStats.avatar_url, 
        stats: {
          wins: userWithStats.wins || 0,
          gamesPlayed: userWithStats.games_played || 0,
          points: userWithStats.total_points || 0,
          unoCount: userWithStats.uno_count || 0
        }
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

app.post('/api/logout', async (req, res) => {
  const { sessionToken } = req.body;
  if (sessionToken) {
    deleteSession(sessionToken);
  }
  res.json({ success: true });
});

app.get('/api/user/:username', async (req, res) => {
  try {
    const user = getUserByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'User topilmadi' });
    }
    const userWithStats = getUserById(user.id);
    res.json({
      username: userWithStats.username,
      displayName: userWithStats.display_name,
      avatar: userWithStats.avatar_url,
      stats: {
        wins: userWithStats.wins || 0,
        losses: userWithStats.losses || 0,
        gamesPlayed: userWithStats.games_played || 0,
        points: userWithStats.total_points || 0,
        unoCount: userWithStats.uno_count || 0
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

app.post('/api/update-profile', async (req, res) => {
  const { sessionToken, displayName, avatar } = req.body;
  
  try {
    const sessionUser = getSessionUser(sessionToken);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Avtorizatsiyadan o\'tmagan' });
    }
    
    const user = users.get(sessionUser.id.toString());
    if (user) {
      user.display_name = displayName;
      user.avatar_url = avatar;
      users.set(sessionUser.id.toString(), user);
    }
    
    const updatedUser = getUserById(sessionUser.id);
    
    res.json({ 
      success: true, 
      user: { 
        username: updatedUser.username, 
        displayName: updatedUser.display_name, 
        avatar: updatedUser.avatar_url, 
        stats: {
          wins: updatedUser.wins || 0,
          gamesPlayed: updatedUser.games_played || 0,
          points: updatedUser.total_points || 0
        }
      } 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = getLeaderboard(10);
    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

app.get('/api/online-users', (req, res) => {
  res.json({ count: onlineUsers.size });
});

app.get('/api/achievements/:username', async (req, res) => {
  try {
    const user = getUserByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'User topilmadi' });
    }
    
    const achievements = getUserAchievements(user.id);
    res.json(achievements);
  } catch (error) {
    console.error('Achievements error:', error);
    res.status(500).json({ error: 'Server xatoligi!' });
  }
});

// ==================== ONLINE USERS TRACKING ====================
const onlineUsers = new Map();

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.userData = null;
  socket.userId = null;

  socket.on('auth', async ({ sessionToken }) => {
    try {
      const sessionUser = getSessionUser(sessionToken);
      if (sessionUser) {
        socket.userId = sessionUser.id;
        socket.userData = { 
          username: sessionUser.username, 
          displayName: sessionUser.display_name, 
          avatar: sessionUser.avatar_url 
        };
        onlineUsers.set(socket.id, { userId: sessionUser.id, username: sessionUser.username });
        socket.emit('authSuccess', socket.userData);
        io.emit('onlineCount', onlineUsers.size);
      } else {
        socket.emit('authFailed');
      }
    } catch (error) {
      console.error('Auth error:', error);
      socket.emit('authFailed');
    }
  });

  socket.on('createRoom', ({ privacy, maxPlayers, password }) => {
    if (!socket.userData) return socket.emit('error', { message: 'Avval tizimga kiring!' });
    
    const roomId = Math.random().toString(36).substr(2, 9).toUpperCase();
    rooms[roomId] = {
      id: roomId, host: socket.id, players: [],
      deck: [], discardPile: [], currentPlayerIndex: 0,
      direction: 1, currentColor: null, gameState: 'waiting',
      pendingDraw: 0, mustDraw: false, winner: null,
      privacy: privacy || 'open', maxPlayers: maxPlayers || 8,
      password: password || null, createdAt: Date.now()
    };
    
    const room = rooms[roomId];
    room.players.push({ 
      id: socket.id, userId: socket.userId, name: socket.userData.displayName, 
      username: socket.userData.username, avatar: socket.userData.avatar, 
      hand: [], saidUno: false, isBot: false, skipTurn: false 
    });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomCreated', { roomId });
    socket.emit('gameUpdate', buildGameState(room, socket.id));
    io.emit('roomListUpdate', getRoomList());
    console.log(`Room ${roomId} created by ${socket.userData.displayName}`);
  });

  socket.on('joinRoom', async ({ roomId, password }) => {
    if (!socket.userData) return socket.emit('error', { message: 'Avval tizimga kiring!' });
    
    const room = getRoom(roomId);
    if (!room) return socket.emit('error', { message: 'Xona topilmadi!' });
    if (room.privacy === 'private' && room.password !== password) {
      return socket.emit('error', { message: 'Xona paroli noto\'g\'ri!' });
    }
    if (room.players.some(p => p.id === socket.id)) {
      return socket.emit('error', { message: 'Siz allaqachon bu xonadasiz!' });
    }
    if (room.gameState !== 'waiting') {
      return socket.emit('error', { message: 'O\'yin allaqachon boshlangan!' });
    }
    if (room.players.length >= room.maxPlayers) {
      return socket.emit('error', { message: `Xona to\'lgan! (maks ${room.maxPlayers})` });
    }
    
    room.players.push({ 
      id: socket.id, userId: socket.userId, name: socket.userData.displayName,
      username: socket.userData.username, avatar: socket.userData.avatar,
      hand: [], saidUno: false, isBot: false, skipTurn: false 
    });
    socket.join(roomId);
    socket.roomId = roomId;
    broadcastState(room);
    io.to(roomId).emit('chatMessage', { type: 'system', message: `${socket.userData.displayName} xonaga qo'shildi!` });
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
      id: botId, name: botName, displayName: botName, avatar: '/avatars/bot.svg',
      hand: [], saidUno: false, isBot: true, skipTurn: false,
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
    io.to(socket.roomId).emit('chatMessage', { type: 'system', message: '🎮 O\'yin boshlandi! Yaxshi o\'yin! Omad!' });
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
    const isJumpIn = (!isCurrentPlayer && card.type !== 'wild' && card.type !== 'wild4' && 
                      card.color === topCard.color && card.value === topCard.value);
    
    if (!isCurrentPlayer && !isJumpIn) return socket.emit('error', { message: 'Siz navbatda emassiz!' });
    if (isCurrentPlayer && !canPlay(card, topCard, room.currentColor, room.mustDraw)) {
      return socket.emit('error', { message: 'Bu kartani o\'ynab bo\'lmaydi!' });
    }
    if (isJumpIn && room.mustDraw) return socket.emit('error', { message: 'Jazo kartasi ustida Jump-In qilib bo\'lmaydi!' });
    
    if (isJumpIn) {
      room.currentPlayerIndex = room.players.indexOf(player);
      io.to(room.id).emit('chatMessage', { type: 'system', message: `⚡ ${player.name} JUMP-IN qildi!` });
    }
    
    const result = applyPlayCard(room, room.currentPlayerIndex, cardIndex, chosenColor);
    io.to(socket.roomId).emit('cardPlayed', { playerName: player.name, card });
    
    if (result && result.won) {
      broadcastState(room);
      io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `🏆 ${player.name} g'olib bo'ldi! (${result.points} ball)` });
      io.emit('roomListUpdate', getRoomList());
      
      if (player.userId) {
        updateUserStats(player.userId, true, result.points, player.saidUno, false);
      }
      
      room.players.forEach(p => {
        if (p.userId && p.id !== socket.id && !p.isBot) {
          updateUserStats(p.userId, false, 0, false, false);
        }
      });
      
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
    if (player && player.hand.length === 1) {
      player.saidUno = true;
      io.to(socket.roomId).emit('chatMessage', { type: 'uno', message: `🎴 ${player.name} UNO dedi!` });
      broadcastState(room);
    }
  });

  socket.on('catchUno', ({ targetId }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const target = room.players.find(p => p.id === targetId);
    if (target && target.hand.length === 1 && !target.saidUno && target.id !== socket.id) {
      const drawn = drawCards(room, 2);
      target.hand.push(...drawn);
      io.to(socket.roomId).emit('chatMessage', {
        type: 'system',
        message: `😱 ${target.name} UNO demaganida ushlandi! +2 karta!`
      });
      broadcastState(room);
      
      if (socket.userId) {
        updateUserStats(socket.userId, false, 0, false, true);
      }
    }
  });

  socket.on('chat', ({ message }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      const cleanMsg = message.substring(0, 200).replace(/[<>]/g, '');
      io.to(socket.roomId).emit('chatMessage', { type: 'player', playerName: player.name, message: cleanMsg });
    }
  });
  
  socket.on('reaction', ({ emoji }) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    io.to(socket.roomId).emit('reaction', { playerId: socket.id, emoji });
  });
  
  socket.on('leaveRoom', () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
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
      io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `${player?.name || 'O\'yinchi'} xonadan chiqdi.` });
    }
    socket.leave(socket.roomId);
    socket.roomId = null;
    io.emit('roomListUpdate', getRoomList());
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    onlineUsers.delete(socket.id);
    io.emit('onlineCount', onlineUsers.size);
    
    const room = getRoom(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
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
      io.to(socket.roomId).emit('chatMessage', { type: 'system', message: `${player?.name || 'O\'yinchi'} uzildi.` });
    }
    io.emit('roomListUpdate', getRoomList());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 UNO Server running on http://localhost:${PORT}`));