'use strict';

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

// ─── 48 World Cup 2026 Teams ────────────────────────────────────────────────
const ALL_TEAMS = [
  // CONMEBOL
  'Argentina','Brazil','Colombia','Ecuador','Uruguay','Venezuela','Bolivia','Paraguay',
  // UEFA
  'Germany','Spain','France','England','Portugal','Netherlands','Belgium','Italy',
  'Switzerland','Austria','Scotland','Denmark','Serbia','Czechia','Croatia','Hungary',
  'Poland','Slovakia','Romania','Slovenia','Albania','Turkey','Ukraine','Georgia',
  // CONCACAF
  'USA','Mexico','Canada','Jamaica','Panama','Honduras','Costa Rica',
  // AFC
  'Japan','South Korea','Australia','Iran','Saudi Arabia','Iraq',
  // CAF
  'Morocco','Egypt','Senegal','Nigeria',
  // OFC
  'New Zealand',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── State ───────────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  players: [],          // string[] — registered names in join order
  assignments: {},      // { name: [team, team, team] }
  drawn: false,         // has the draw been done
  eliminated: [],       // string[] — teams marked as out
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
  return { ...DEFAULT_STATE, players: [], assignments: {}, eliminated: [] };
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

let state = loadState();

// ─── HTTP ─────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Send full state on connect
  socket.emit('state', state);

  // ── Join ──────────────────────────────────────────────────────────────────
  socket.on('join_player', (name) => {
    name = (name || '').trim();
    if (!name) return;

    // Block new joins after draw is done
    if (state.drawn) {
      socket.emit('error_msg', 'The draw has already been made — you can\'t join now.');
      return;
    }

    // Deduplicate (case-insensitive)
    const exists = state.players.some(p => p.toLowerCase() === name.toLowerCase());
    if (!exists) {
      state.players.push(name);
      saveState();
    }
    io.emit('state', state);
  });

  // ── Draw ──────────────────────────────────────────────────────────────────
  socket.on('draw_sweepstake', (requester) => {
    // Only Dan can draw
    if (!requester || requester.trim().toLowerCase() !== 'dan') {
      socket.emit('error_msg', 'Only Dan can run the draw.');
      return;
    }
    if (state.players.length < 2) {
      socket.emit('error_msg', 'Need at least 2 players to draw.');
      return;
    }

    const teamsNeeded = state.players.length * 3;
    const pool = shuffle(ALL_TEAMS).slice(0, teamsNeeded);

    state.assignments = {};
    state.players.forEach((player, i) => {
      state.assignments[player] = [
        pool[i * 3],
        pool[i * 3 + 1],
        pool[i * 3 + 2],
      ];
    });
    state.drawn = true;
    state.eliminated = [];
    saveState();
    io.emit('state', state);
  });

  // ── Reset draw ────────────────────────────────────────────────────────────
  socket.on('reset_draw', (requester) => {
    if (!requester || requester.trim().toLowerCase() !== 'dan') {
      socket.emit('error_msg', 'Only Dan can reset the draw.');
      return;
    }
    state.assignments = {};
    state.drawn = false;
    state.eliminated = [];
    saveState();
    io.emit('state', state);
  });

  // ── Full reset (players + draw) ───────────────────────────────────────────
  socket.on('full_reset', (requester) => {
    if (!requester || requester.trim().toLowerCase() !== 'dan') {
      socket.emit('error_msg', 'Only Dan can reset everything.');
      return;
    }
    state = { ...DEFAULT_STATE, players: [], assignments: {}, eliminated: [] };
    saveState();
    io.emit('state', state);
  });

  // ── Toggle eliminated ─────────────────────────────────────────────────────
  socket.on('toggle_eliminated', ({ team, requester }) => {
    if (!requester || requester.trim().toLowerCase() !== 'dan') {
      socket.emit('error_msg', 'Only Dan can mark teams as eliminated.');
      return;
    }
    const idx = state.eliminated.indexOf(team);
    if (idx === -1) {
      state.eliminated.push(team);
    } else {
      state.eliminated.splice(idx, 1);
    }
    saveState();
    io.emit('state', state);
  });
});

httpServer.listen(PORT, () => {
  console.log(`carryonsweepstake running on port ${PORT}`);
});
