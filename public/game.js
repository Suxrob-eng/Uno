// ==========================================
//   UNO ONLINE - CLIENT GAME LOGIC (TUZATILGAN)
// ==========================================

const socket = io();

// ==================== STATE ====================
let state = {
  screen: 'lobby',
  roomId: null,
  myId: null,
  playerName: '',
  isHost: false,
  gameState: null,
  pendingCard: null,
  chatOpen: false,
  unreadChat: 0
};
 
let turnTimerInterval;

// ==================== DOM REFERENCES ====================
const screens = {
  lobby: document.getElementById('lobby-screen'),
  waiting: document.getElementById('waiting-screen'),
  game: document.getElementById('game-screen')
};

const els = {
  playerName: document.getElementById('player-name'),
  createRoomBtn: document.getElementById('create-room-btn'),
  roomCode: document.getElementById('room-code'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  refreshRoomsBtn: document.getElementById('refresh-rooms-btn'),
  roomsList: document.getElementById('rooms-list'),

  roomCodeDisplay: document.getElementById('room-code-display'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  waitingPlayers: document.getElementById('waiting-players'),
  botControls: document.getElementById('bot-controls'),
  addBotBtn: document.getElementById('add-bot-btn'),
  botDifficulty: document.getElementById('bot-difficulty'),
  startGameBtn: document.getElementById('start-game-btn'),
  waitingMessage: document.getElementById('waiting-message'),
  leaveRoomBtn: document.getElementById('leave-room-btn'),

  otherPlayers: document.getElementById('other-players'),
  topCard: document.getElementById('top-card'),
  currentColorBadge: document.getElementById('current-color-badge'),
  drawBtn: document.getElementById('draw-btn'),
  deckCount: document.getElementById('deck-count'),
  currentTurnName: document.getElementById('current-turn-name'),
  directionIndicator: document.getElementById('direction-indicator'),
  myHand: document.getElementById('my-hand'),
  myNameDisplay: document.getElementById('my-name-display'),
  myCardCount: document.getElementById('my-card-count'),

  unoBtn: document.getElementById('uno-btn'),
  catchUnoBtn: document.getElementById('catch-uno-btn'),

  chatPanel: document.getElementById('chat-panel'),
  toggleChatBtn: document.getElementById('toggle-chat-btn'),
  chatToggleBtn: document.getElementById('chat-toggle-btn'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  sendChatBtn: document.getElementById('send-chat-btn'),

  colorPicker: document.getElementById('color-picker'),
  winModal: document.getElementById('win-modal'),
  winTitle: document.getElementById('win-title'),
  winMessage: document.getElementById('win-message'),
  playAgainBtn: document.getElementById('play-again-btn'),
  goLobbyBtn: document.getElementById('go-lobby-btn'),

  errorToast: document.getElementById('error-toast'),
  notifToast: document.getElementById('notif-toast')
};

// ==================== SCREEN MANAGEMENT ====================
function showScreen(name) {
  Object.values(screens).forEach(s => {
    if (s) {
      s.classList.remove('active');
      s.style.display = 'none';
    }
  });
  if (screens[name]) {
    screens[name].style.display = 'flex';
    requestAnimationFrame(() => screens[name].classList.add('active'));
  }
  state.screen = name;
}

// ==================== TOAST ====================
let errorTimeout, notifTimeout;

function showError(msg) {
  if (!els.errorToast) return;
  els.errorToast.textContent = msg;
  els.errorToast.classList.remove('hidden');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => els.errorToast.classList.add('hidden'), 3000);
}

function showNotif(msg) {
  if (!els.notifToast) return;
  els.notifToast.textContent = msg;
  els.notifToast.classList.remove('hidden');
  clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => els.notifToast.classList.add('hidden'), 3000);
}

// ==================== CARD RENDERING ====================
function getCardLabel(card) {
  if (!card) return '?';
  const labels = { 'skip': '⊘', 'reverse': '↺', 'draw2': '+2', 'wild': '★', 'wild4': '+4' };
  return labels[card.value] || card.value;
}

function createCardElement(card, isPlayable = true) {
  const div = document.createElement('div');
  const colorClass = (card.type === 'wild' || card.type === 'wild4') ? 'wild' : card.color;
  div.className = `card ${colorClass}`;
  const label = getCardLabel(card);
  div.innerHTML = `
    <span class="card-corner tl">${label}</span>
    <span class="card-value-center">${label}</span>
    <span class="card-corner br">${label}</span>
  `;
  if (!isPlayable) div.classList.add('not-playable');
  return div;
}

function renderTopCard(card) {
  if (!card) return;
  const colorClass = (card.type === 'wild' || card.type === 'wild4') ? 'wild' : card.color;
  const label = getCardLabel(card);
  if (els.topCard) {
    els.topCard.className = `card top-card ${colorClass}`;
    els.topCard.innerHTML = `
      <span class="card-corner tl">${label}</span>
      <span class="card-value-center">${label}</span>
      <span class="card-corner br">${label}</span>
    `;
  }
}

function getColorName(color) {
  const names = { red: '🔴 Qizil', green: '🟢 Yashil', blue: '🔵 Ko\'k', yellow: '🟡 Sariq' };
  return names[color] || color;
}

// ==================== GAME UI UPDATE ====================
function updateGameUI(gs) {
  if (!gs) return;
  state.gameState = gs;

  const me = gs.players?.find(p => p.isMe);
  const isMyTurn = gs.currentPlayerId === state.myId;

  if (gs.topCard) renderTopCard(gs.topCard);

  if (els.currentColorBadge && gs.currentColor) {
    els.currentColorBadge.className = `color-badge ${gs.currentColor}`;
    els.currentColorBadge.textContent = getColorName(gs.currentColor);
  }
  if (els.deckCount) els.deckCount.textContent = gs.deckCount || 0;

  const currentPlayer = gs.players?.find(p => p.isCurrentPlayer);
  if (els.currentTurnName) {
    els.currentTurnName.textContent = currentPlayer
      ? (currentPlayer.isMe ? 'Siz' : currentPlayer.name)
      : '—';
  }
  if (els.directionIndicator) {
    els.directionIndicator.textContent = gs.direction === 1 ? '→' : '←';
  }
  
  if (gs.gameState === 'playing' && gs.turnStartTime && gs.turnDuration) {
    const container = document.getElementById('turn-timer-container');
    const bar = document.getElementById('turn-timer-bar');
    if (container && bar) {
      container.style.display = 'block';
      clearInterval(turnTimerInterval);
      
      const updateTimer = () => {
        const elapsed = Date.now() - gs.turnStartTime;
        let remaining = gs.turnDuration - elapsed;
        if (remaining < 0) remaining = 0;
        
        let percent = (remaining / gs.turnDuration) * 100;
        bar.style.width = percent + '%';
        
        if (percent > 50) {
          bar.style.background = '#2ecc71';
        } else if (percent > 20) {
          bar.style.background = '#f1c40f';
        } else {
          bar.style.background = '#e74c3c';
        }
      };
      
      updateTimer();
      turnTimerInterval = setInterval(updateTimer, 100);
    }
  } else {
    const container = document.getElementById('turn-timer-container');
    if (container) container.style.display = 'none';
    clearInterval(turnTimerInterval);
  }

  if (me) {
    if (els.myNameDisplay) els.myNameDisplay.textContent = me.name;
    if (els.myCardCount) els.myCardCount.textContent = `${me.cardCount} karta`;
  }

  renderMyHand(gs, isMyTurn);
  renderOtherPlayers(gs);

  if (els.drawBtn) {
    els.drawBtn.classList.toggle('disabled', !isMyTurn || gs.gameState !== 'playing');
  }

  if (els.unoBtn) {
    els.unoBtn.style.display = (me && me.cardCount <= 2 && gs.gameState === 'playing') ? 'block' : 'none';
  }

  const catchTarget = gs.players?.find(p => !p.isMe && p.cardCount === 1 && !p.saidUno);
  if (els.catchUnoBtn) {
    if (catchTarget && gs.gameState === 'playing') {
      els.catchUnoBtn.style.display = 'block';
      els.catchUnoBtn.dataset.targetId = catchTarget.id;
    } else {
      els.catchUnoBtn.style.display = 'none';
    }
  }

  if (gs.gameState === 'finished' && gs.winner) showWinModal(gs.winner);
}

function canPlayCard(card, topCard, currentColor, mustDraw, isCurrentPlayer = true) {
  if (!card || !topCard) return false;
  if (!isCurrentPlayer) return false;
  if (mustDraw) return card.value === 'draw2' || card.value === 'wild4';
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function renderMyHand(gs, isMyTurn) {
  if (!els.myHand) return;
  els.myHand.innerHTML = '';
  const myHand = gs.players?.find(p => p.isMe)?.hand || [];
  
  myHand.forEach((card, index) => {
    const isJumpIn = (!isMyTurn && card.type !== 'wild' && card.type !== 'wild4' && card.color === gs.topCard?.color && card.value === gs.topCard?.value && !gs.mustDraw);
    const playable = (isMyTurn && gs.gameState === 'playing' && canPlayCard(card, gs.topCard, gs.currentColor, gs.mustDraw, isMyTurn)) || 
                     (gs.gameState === 'playing' && isJumpIn);

    const wrapper = document.createElement('div');
    wrapper.className = 'hand-card';
    if (!playable) wrapper.classList.add('not-playable');
    if (isJumpIn) wrapper.classList.add('jump-in-glow');
    const cardEl = createCardElement(card, playable);
    wrapper.appendChild(cardEl);
    if (playable) wrapper.addEventListener('click', () => onPlayCard(card, index));
    els.myHand.appendChild(wrapper);
  });
}

function renderOtherPlayers(gs) {
  if (!els.otherPlayers) return;
  els.otherPlayers.innerHTML = '';
  const otherPlayers = gs.players?.filter(p => !p.isMe) || [];
  
  otherPlayers.forEach(player => {
    const area = document.createElement('div');
    area.className = `opponent-area ${player.isCurrentPlayer ? 'active-glow' : ''}`;

    const cardCount = Math.min(player.cardCount, 10);
    let miniCards = '';
    for (let i = 0; i < cardCount; i++) {
      miniCards += `<div class="mini-card" style="z-index:${i}"></div>`;
    }

    area.innerHTML = `
      <div class="opponent-info">
        <div class="opponent-name ${player.isCurrentPlayer ? 'active' : ''}">
          ${escapeHtml(player.name)} ${player.isCurrentPlayer ? '▼' : ''}
        </div>
        ${player.isBot ? '<span class="bot-indicator">🤖 BOT</span>' : ''}
        <div class="card-count-badge">${player.cardCount} karta</div>
        ${player.saidUno && player.cardCount === 1 ? '<div class="uno-badge">UNO!</div>' : ''}
      </div>
      <div class="opponent-cards">${miniCards}</div>
    `;

    els.otherPlayers.appendChild(area);
  });
}

// ==================== PLAY CARD ====================
function onPlayCard(card, index) {
  if (card.type === 'wild' || card.type === 'wild4') {
    state.pendingCard = { card, index };
    showColorPicker();
  } else {
    socket.emit('playCard', { cardIndex: index });
  }
}

function showColorPicker() { 
  if (els.colorPicker) els.colorPicker.classList.remove('hidden'); 
}
function hideColorPicker() { 
  if (els.colorPicker) els.colorPicker.classList.add('hidden'); 
}

if (document.querySelectorAll('.color-btn')) {
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.pendingCard) {
        socket.emit('playCard', { cardIndex: state.pendingCard.index, chosenColor: btn.dataset.color });
        state.pendingCard = null;
      }
      hideColorPicker();
    });
  });
}

if (els.colorPicker) {
  const backdrop = els.colorPicker.querySelector('.modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      state.pendingCard = null;
      hideColorPicker();
    });
  }
}

// ==================== WIN MODAL ====================
function showWinModal(winner) {
  if (!els.winModal) return;
  const isWinner = winner?.id === state.myId;
  const winnerIsBot = winner?.id && winner.id.toString().startsWith('BOT_');

  if (isWinner) {
    if (els.winTitle) els.winTitle.textContent = '🎉 Siz g\'oldingiz!';
    if (els.winMessage) els.winMessage.textContent = 'Tabriklaymiz! Zo\'r o\'yin!';
  } else if (winnerIsBot) {
    if (els.winTitle) els.winTitle.textContent = '🤖 Bot g\'olib bo\'ldi!';
    if (els.winMessage) els.winMessage.textContent = `${winner?.name || 'Bot'} sizni yutdi! Yana bir bor urinib ko\'ring!`;
  } else {
    if (els.winTitle) els.winTitle.textContent = `😢 ${winner?.name || 'O\'yinchi'} g\'olib!`;
    if (els.winMessage) els.winMessage.textContent = `${winner?.name || 'O\'yinchi'} barcha kartalarini o\'ynadi!`;
  }

  if (els.playAgainBtn) els.playAgainBtn.style.display = state.isHost ? 'block' : 'none';
  els.winModal.classList.remove('hidden');
}

if (els.playAgainBtn) {
  els.playAgainBtn.addEventListener('click', () => {
    socket.emit('playAgain');
    if (els.winModal) els.winModal.classList.add('hidden');
  });
}

if (els.goLobbyBtn) {
  els.goLobbyBtn.addEventListener('click', () => location.reload());
}

// ==================== WAITING ROOM ====================
function updateWaitingRoom(gs) {
  if (!els.waitingPlayers) return;
  els.waitingPlayers.innerHTML = '';

  const capacityText = document.getElementById('waiting-capacity-text');
  const capacityFill = document.getElementById('capacity-fill');
  if (capacityText && capacityFill && gs) {
    capacityText.textContent = `${gs.players?.length || 0}/${gs.maxPlayers || 8} o'yinchi`;
    const percent = Math.min(100, ((gs.players?.length || 0) / (gs.maxPlayers || 8)) * 100);
    capacityFill.style.width = `${percent}%`;
  }

  const privacyBadge = document.getElementById('room-privacy-badge');
  if (privacyBadge && gs) {
    if (gs.privacy === 'private') {
      privacyBadge.className = 'privacy-badge private';
      privacyBadge.innerHTML = '🔒 Yopiq';
    } else {
      privacyBadge.className = 'privacy-badge open';
      privacyBadge.innerHTML = '🌐 Ochiq';
    }
  }

  const avatarColors = ['#e74c3c', '#3498db', '#27ae60', '#f39c12'];
  const humanEmojis = ['😎', '🦊', '🐼', '🦁'];
  const players = gs?.players || [];

  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'waiting-player';

    const isMe = p.id === state.myId;
    const canRemove = state.isHost && p.isBot && gs?.gameState === 'waiting';

    div.innerHTML = `
      <div class="player-avatar" style="background:${avatarColors[i % 4]}20;border:2px solid ${avatarColors[i % 4]}">
        ${p.isBot ? '🤖' : humanEmojis[i % 4]}
      </div>
      <div class="waiting-player-info">
        <div class="waiting-player-name">${escapeHtml(p.name)}</div>
        <div class="waiting-player-role">
          ${isMe ? 'Sen · ' : ''}${i === 0 ? 'Host' : 'O\'yinchi'}
          ${p.isBot ? '<span class="bot-badge">BOT</span>' : ''}
        </div>
      </div>
      ${isMe ? '<span style="color:#ffd32a;font-size:16px">★</span>' : ''}
      ${canRemove ? `<button class="remove-bot-btn" data-bot-id="${p.id}" title="Botni o'chirish">✕</button>` : ''}
    `;

    const removeBtn = div.querySelector('.remove-bot-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        socket.emit('removeBot', { botId: removeBtn.dataset.botId });
      });
    }

    els.waitingPlayers.appendChild(div);
  });

  if (state.isHost) {
    if (els.botControls) els.botControls.style.display = (players.length < (gs?.maxPlayers || 8)) ? 'flex' : 'none';
    if (els.startGameBtn) els.startGameBtn.style.display = players.filter(p => !p.isBot).length >= 1 ? 'block' : 'none';
    if (els.waitingMessage) {
      els.waitingMessage.textContent = players.filter(p => !p.isBot).length < 1
        ? 'Kamida 1 haqiqiy o\'yinchi kerak...'
        : 'O\'yinni boshlashga tayyor!';
    }
  } else {
    if (els.botControls) els.botControls.style.display = 'none';
    if (els.startGameBtn) els.startGameBtn.style.display = 'none';
    if (els.waitingMessage) els.waitingMessage.textContent = 'Host o\'yinni boshlashini kutmoqda...';
  }
}

// ==================== CHAT ====================
function addChatMessage(data) {
  if (!els.chatMessages) return;
  const div = document.createElement('div');

  if (data.type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = data.message;
  } else if (data.type === 'uno') {
    div.className = 'chat-msg uno-msg';
    div.textContent = data.message;
  } else {
    const isMe = data.playerName === state.playerName;
    div.className = `chat-msg ${isMe ? 'my-msg' : 'player-msg'}`;
    div.innerHTML = `
      ${!isMe ? `<div class="chat-sender">${escapeHtml(data.playerName)}</div>` : ''}
      <div>${escapeHtml(data.message)}</div>
    `;
  }

  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  if (!state.chatOpen && state.screen === 'game') {
    state.unreadChat++;
    updateChatBadge();
  }
}

function updateChatBadge() {
  if (!els.chatToggleBtn) return;
  let badge = els.chatToggleBtn.querySelector('.chat-badge');
  if (state.unreadChat > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'chat-badge';
      els.chatToggleBtn.style.position = 'relative';
      els.chatToggleBtn.appendChild(badge);
    }
    badge.textContent = state.unreadChat > 9 ? '9+' : state.unreadChat;
  } else if (badge) {
    badge.remove();
  }
}

function toggleChat() {
  state.chatOpen = !state.chatOpen;
  if (els.chatPanel) els.chatPanel.classList.toggle('open', state.chatOpen);
  if (state.chatOpen) {
    state.unreadChat = 0;
    updateChatBadge();
    setTimeout(() => {
      if (els.chatInput) els.chatInput.focus();
    }, 300);
  }
}

if (els.chatToggleBtn) els.chatToggleBtn.addEventListener('click', toggleChat);
if (els.toggleChatBtn) els.toggleChatBtn.addEventListener('click', toggleChat);
if (els.sendChatBtn) els.sendChatBtn.addEventListener('click', sendChat);
if (els.chatInput) {
  els.chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

function sendChat() {
  const msg = els.chatInput?.value.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  if (els.chatInput) els.chatInput.value = '';
}

// ==================== UTILITY ====================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

function validateName() {
  const name = els.playerName?.value.trim();
  if (!name) { showError('Iltimos, ismingizni kiriting!'); els.playerName?.focus(); return null; }
  return name;
}

// ==================== LOBBY EVENTS ====================
if (els.createRoomBtn) {
  els.createRoomBtn.addEventListener('click', () => {
    const name = validateName();
    if (!name) return;
    state.playerName = name;
    const modal = document.getElementById('create-room-modal');
    if (modal) modal.classList.remove('hidden');
  });
}

// CREATE ROOM MODAL LOGIC
const createModal = document.getElementById('create-room-modal');
const typeOpen = document.getElementById('type-open');
const typePrivate = document.getElementById('type-private');
const checkOpen = document.getElementById('check-open');
const checkPrivate = document.getElementById('check-private');
const maxPlayersDisplay = document.getElementById('max-players-display');
const countMinus = document.getElementById('count-minus');
const countPlus = document.getElementById('count-plus');
const confirmCreateBtn = document.getElementById('confirm-create-btn');
const cancelCreateBtn = document.getElementById('cancel-create-btn');

let selectedPrivacy = 'open';
let selectedMaxPlayers = 8;
if (maxPlayersDisplay) maxPlayersDisplay.textContent = selectedMaxPlayers;

if (typeOpen) {
  typeOpen.addEventListener('click', () => {
    selectedPrivacy = 'open';
    typeOpen.classList.add('active');
    if (typePrivate) typePrivate.classList.remove('active');
    if (checkOpen) checkOpen.classList.remove('hidden');
    if (checkPrivate) checkPrivate.classList.add('hidden');
  });
}

if (typePrivate) {
  typePrivate.addEventListener('click', () => {
    selectedPrivacy = 'private';
    typePrivate.classList.add('active');
    if (typeOpen) typeOpen.classList.remove('active');
    if (checkPrivate) checkPrivate.classList.remove('hidden');
    if (checkOpen) checkOpen.classList.add('hidden');
  });
}

if (countMinus) {
  countMinus.addEventListener('click', () => {
    if (selectedMaxPlayers > 2) {
      selectedMaxPlayers--;
      if (maxPlayersDisplay) maxPlayersDisplay.textContent = selectedMaxPlayers;
    }
  });
}

if (countPlus) {
  countPlus.addEventListener('click', () => {
    if (selectedMaxPlayers < 8) {
      selectedMaxPlayers++;
      if (maxPlayersDisplay) maxPlayersDisplay.textContent = selectedMaxPlayers;
    }
  });
}

if (cancelCreateBtn) {
  cancelCreateBtn.addEventListener('click', () => {
    if (createModal) createModal.classList.add('hidden');
  });
}

if (confirmCreateBtn) {
  confirmCreateBtn.addEventListener('click', () => {
    if (createModal) createModal.classList.add('hidden');
    socket.emit('createRoom', { 
      playerName: state.playerName,
      privacy: selectedPrivacy,
      maxPlayers: selectedMaxPlayers
    });
  });
}

if (els.joinRoomBtn) {
  els.joinRoomBtn.addEventListener('click', () => {
    const name = validateName();
    if (!name) return;
    const code = els.roomCode?.value.trim().toUpperCase();
    if (!code) return showError('Xona kodini kiriting!');
    state.playerName = name;
    socket.emit('joinRoom', { roomId: code, playerName: name });
  });
}

if (els.refreshRoomsBtn) {
  els.refreshRoomsBtn.addEventListener('click', () => socket.emit('getRoomList'));
}
if (els.playerName) {
  els.playerName.addEventListener('keydown', e => { if (e.key === 'Enter' && els.createRoomBtn) els.createRoomBtn.click(); });
}
if (els.roomCode) {
  els.roomCode.addEventListener('keydown', e => { if (e.key === 'Enter' && els.joinRoomBtn) els.joinRoomBtn.click(); });
}

// ==================== WAITING ROOM EVENTS ====================
if (els.startGameBtn) {
  els.startGameBtn.addEventListener('click', () => socket.emit('startGame'));
}
if (els.leaveRoomBtn) {
  els.leaveRoomBtn.addEventListener('click', () => location.reload());
}
if (els.copyCodeBtn) {
  els.copyCodeBtn.addEventListener('click', () => {
    const code = els.roomCodeDisplay?.textContent;
    if (code) {
      navigator.clipboard.writeText(code)
        .then(() => showNotif('📋 Kod nusxa olindi!'))
        .catch(() => showNotif(`Kod: ${code}`));
    }
  });
}

if (els.addBotBtn) {
  els.addBotBtn.addEventListener('click', () => {
    const difficulty = els.botDifficulty?.value || 'medium';
    socket.emit('addBot', { difficulty });
  });
}

// ==================== GAME EVENTS ====================
if (els.drawBtn) {
  els.drawBtn.addEventListener('click', () => {
    if (!els.drawBtn.classList.contains('disabled')) socket.emit('drawCard');
  });
}
if (els.unoBtn) {
  els.unoBtn.addEventListener('click', () => {
    socket.emit('sayUno');
    showNotif('🎴 UNO!');
  });
}
if (els.catchUnoBtn) {
  els.catchUnoBtn.addEventListener('click', () => {
    const targetId = els.catchUnoBtn.dataset.targetId;
    if (targetId) socket.emit('catchUno', { targetId });
  });
}

// ==================== SOCKET EVENTS ====================
socket.on('connect', () => {
  state.myId = socket.id;
  socket.emit('getRoomList');
});

socket.on('roomCreated', ({ roomId }) => {
  state.roomId = roomId;
  state.isHost = true;
  if (els.roomCodeDisplay) els.roomCodeDisplay.textContent = roomId;
  showScreen('waiting');
});

socket.on('gameUpdate', (gs) => {
  if (!gs) return;
  if (state.screen === 'waiting') {
    const realPlayers = gs.players?.filter(p => !p.isBot) || [];
    state.isHost = realPlayers.length > 0 && realPlayers[0]?.id === state.myId;
    if (els.roomCodeDisplay && state.roomId) els.roomCodeDisplay.textContent = state.roomId;
    updateWaitingRoom(gs);
  } else if (state.screen === 'game') {
    updateGameUI(gs);
  }
  if (gs.gameState === 'waiting' && state.roomId && state.screen === 'lobby') {
    showScreen('waiting');
    const realPlayers = gs.players?.filter(p => !p.isBot) || [];
    state.isHost = realPlayers.length > 0 && realPlayers[0]?.id === state.myId;
    updateWaitingRoom(gs);
  }
});

socket.on('gameStarted', () => showScreen('game'));

socket.on('roomListUpdate', (rooms) => {
  if (state.screen !== 'lobby' || !els.roomsList) return;
  els.roomsList.innerHTML = '';
  if (!rooms || rooms.length === 0) {
    els.roomsList.innerHTML = '<div class="no-rooms">Hozircha xona yo\'q</div>';
    return;
  }
  rooms.forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-item';
    div.innerHTML = `
      <div>
        <div class="room-item-info">${escapeHtml(room.id)}</div>
        <div class="room-item-count">Host: ${escapeHtml(room.host)} · ${room.playerCount}/${room.maxPlayers}</div>
      </div>
      <button class="join-btn-small" data-room="${room.id}">Qo'shilish</button>
    `;
    div.querySelector('.join-btn-small').addEventListener('click', () => {
      if (els.roomCode) els.roomCode.value = room.id;
      const name = els.playerName?.value.trim();
      if (!name) { showError('Avval ismingizni kiriting!'); els.playerName?.focus(); return; }
      state.playerName = name;
      socket.emit('joinRoom', { roomId: room.id, playerName: name });
    });
    els.roomsList.appendChild(div);
  });
});

socket.on('chatMessage', data => addChatMessage(data));

socket.on('cardPlayed', ({ playerName, card, botDrew }) => {
  if (playerName !== state.playerName) {
    if (botDrew) {
      showNotif(`🤖 ${playerName} karta oldi`);
    } else if (card) {
      const label = getCardLabel(card);
      showNotif(`${playerName}: ${label}`);
    }
  }
});

socket.on('error', ({ message }) => showError(message));

document.querySelectorAll('.btn-reaction').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('reaction', { emoji: btn.dataset.emoji });
    btn.style.pointerEvents = 'none';
    btn.style.transform = 'scale(0.8)';
    setTimeout(() => {
      btn.style.pointerEvents = 'auto';
      btn.style.transform = '';
    }, 500);
  });
});

socket.on('reaction', ({ playerId, emoji }) => {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;
  
  if (playerId === state.myId) {
    const rect = document.querySelector('.player-area').getBoundingClientRect();
    el.style.left = (rect.left + rect.width / 2 - 16) + 'px';
    el.style.top = (rect.top - 20) + 'px';
  } else {
    // If opponent, just spawn near top
    el.style.left = (Math.random() * 60 + 20) + '%';
    el.style.top = '150px';
  }
  
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

// ==================== INIT ====================
showScreen('lobby');
socket.emit('getRoomList');

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideColorPicker();
  if ((e.key === 'u' || e.key === 'U') && state.screen === 'game' && document.activeElement?.tagName !== 'INPUT') {
    socket.emit('sayUno');
  }
});

console.log('🎮 UNO Online (Bot Support) yuklandi!');