/**
 * NeonChat — app.js
 * Client-side logic. Works standalone (localStorage simulation)
 * oppure connettiti al server Python/PHP via WebSocket.
 */

"use strict";

/* ───────────────────────────────────────────
   STATO APPLICAZIONE
─────────────────────────────────────────── */
const App = {
  username:    null,
  currentRoom: null,
  rooms:       { "generale": [], "tech": [], "random": [] },
  users:       {},        // username → { color, joinedAt }
  ws:          null,
  typingTimer: null,
  isTyping:    false,
  msgIdCounter: 0,

  // Colori avatar generati deterministicamente
  colors: [
    "#00f0c8","#00aaff","#ff00aa","#ffaa00","#aa00ff","#00ffaa","#ff5500","#0055ff"
  ],
  getColor(name) {
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return App.colors[h % App.colors.length];
  }
};

/* ───────────────────────────────────────────
   DOM REFS
─────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const authScreen    = $("auth-screen");
const chatScreen    = $("chat-screen");
const usernameInput = $("username-input");
const roomInput     = $("room-input");
const joinBtn       = $("join-btn");
const authStatus    = $("auth-status");
const messages      = $("messages");
const msgInput      = $("msg-input");
const sendBtn       = $("send-btn");
const charCount     = $("char-count");
const emojiBtn      = $("emoji-btn");
const emojiPicker   = $("emoji-picker");
const roomList      = $("room-list");
const userList      = $("user-list");
const currentRoomName = $("current-room-name");
const roomUsersCount  = $("room-users-count");
const myUsernameEl  = $("my-username");
const myAvatarEl    = $("my-avatar");
const typingEl      = $("typing-indicator");
const logoutBtn     = $("logout-btn");
const newRoomBtn    = $("new-room-btn");
const clearBtn      = $("clear-btn");

/* ───────────────────────────────────────────
   AUTH
─────────────────────────────────────────── */
function showStatus(msg, type = "error") {
  authStatus.textContent = msg;
  authStatus.className = type;
}

joinBtn.addEventListener("click", doJoin);
[usernameInput, roomInput].forEach(el => el.addEventListener("keydown", e => { if(e.key==="Enter") doJoin(); }));

function doJoin() {
  const name = usernameInput.value.trim();
  const room = roomInput.value.trim() || "generale";
  if (!name) { showStatus("⚠ Inserisci un nickname"); return; }
  if (name.length < 2) { showStatus("⚠ Nickname troppo corto (min. 2 caratteri)"); return; }

  showStatus("Connessione in corso...", "success");
  joinBtn.disabled = true;

  // Tentativo WebSocket verso server locale; fallback a modalità offline
  tryWebSocket(name, room, () => initOfflineMode(name, room));
}

/* ───────────────────────────────────────────
   WEBSOCKET (server Python o PHP)
─────────────────────────────────────────── */
function tryWebSocket(name, room, fallback) {
  const wsUrl = "ws://localhost:8765";
  let ws;
  let didFallback = false;
  let connected   = false;

  function doFallback() {
    if (didFallback) return;
    didFallback = true;
    try { ws && ws.close(); } catch(_) {}
    fallback();
  }

  // Se il browser non supporta WebSocket → offline
  if (!window.WebSocket) { fallback(); return; }

  try {
    ws = new WebSocket(wsUrl);
  } catch(e) {
    fallback();
    return;
  }

  // Timeout: se entro 2s non si connette → offline
  const timeout = setTimeout(doFallback, 2000);

  ws.onopen = () => {
    if (didFallback) { ws.close(); return; }
    clearTimeout(timeout);
    connected  = true;
    App.ws     = ws;
    App.username = name;
    ws.send(JSON.stringify({ type: "join", username: name, room }));
    initChat(name, room);
  };

  ws.onmessage = e => {
    try { handleServerMsg(JSON.parse(e.data)); } catch(_) {}
  };

  ws.onclose = () => {
    clearTimeout(timeout);
    if (!connected) {
      // Non si era mai aperto → fallback offline
      doFallback();
    } else {
      App.ws = null;
      if (typeof addSystemMsg === "function")
        addSystemMsg("⚠ Connessione al server persa. Ricarica la pagina per riconnetterti.");
    }
  };

  // onerror è sempre seguito da onclose, quindi basta pulire il timeout
  ws.onerror = () => {
    clearTimeout(timeout);
    // onclose verrà chiamato subito dopo e gestirà il fallback
  };
}

function handleServerMsg(data) {
  switch(data.type) {
    case "message":
      displayMessage(data.username, data.text, data.timestamp, data.username === App.username);
      break;
    case "join":
      addSystemMsg(`${data.username} è entrato nella stanza`);
      addUser(data.username);
      break;
    case "leave":
      addSystemMsg(`${data.username} ha lasciato la stanza`);
      removeUser(data.username);
      break;
    case "typing":
      if(data.username !== App.username) showTyping(data.username, data.active);
      break;
    case "users":
      data.users.forEach(u => addUser(u));
      break;
    case "history":
      data.messages.forEach(m => displayMessage(m.username, m.text, m.timestamp, m.username === App.username, false));
      break;
    case "error":
      showStatus(data.message);
      break;
  }
}

/* ───────────────────────────────────────────
   MODALITÀ OFFLINE (demo senza server)
─────────────────────────────────────────── */
function initOfflineMode(name, room) {
  App.username = name;
  initChat(name, room);
  addSystemMsg("🔌 Server non trovato — modalità demo attiva. Apri più schede per simulare chat!");
  addUser(name);

  // Salva in localStorage per cross-tab (simulazione multi-utente)
  const channel = new BroadcastChannel(`neonchat_${room}`);
  App.channel = channel;

  channel.onmessage = e => {
    const d = e.data;
    if (d.type === "message" && d.from !== App.username) {
      displayMessage(d.from, d.text, d.ts, false);
    } else if (d.type === "join" && d.from !== App.username) {
      addSystemMsg(`${d.from} è entrato nella stanza`);
      addUser(d.from);
    } else if (d.type === "leave" && d.from !== App.username) {
      addSystemMsg(`${d.from} ha lasciato la stanza`);
      removeUser(d.from);
    } else if (d.type === "typing" && d.from !== App.username) {
      showTyping(d.from, d.active);
    }
  };

  // Annuncia la mia entrata
  channel.postMessage({ type:"join", from: name });

  // Override send per broadcast
  App.sendMessage = text => {
    const ts = new Date().toISOString();
    displayMessage(name, text, ts, true);
    channel.postMessage({ type:"message", from: name, text, ts });
    // Salva in storia locale
    if (!App.rooms[room]) App.rooms[room] = [];
    App.rooms[room].push({ username:name, text, ts });
  };

  App.sendTyping = active => channel.postMessage({ type:"typing", from: name, active });
}

/* ───────────────────────────────────────────
   INIT CHAT UI
─────────────────────────────────────────── */
function initChat(name, room) {
  App.currentRoom = room;
  authScreen.classList.remove("active");
  chatScreen.style.display = "flex";

  myUsernameEl.textContent = name;
  myAvatarEl.textContent   = name[0].toUpperCase();
  myAvatarEl.style.background = `linear-gradient(135deg, ${App.getColor(name)}, #0055ff)`;

  // Se non override da offline, usa WS
  if (!App.sendMessage) {
    App.sendMessage = text => {
      if (App.ws && App.ws.readyState === WebSocket.OPEN) {
        App.ws.send(JSON.stringify({ type:"message", text, room: App.currentRoom }));
      }
    };
    App.sendTyping = active => {
      if (App.ws && App.ws.readyState === WebSocket.OPEN) {
        App.ws.send(JSON.stringify({ type:"typing", active, room: App.currentRoom }));
      }
    };
  }

  renderRoomList(room);
  updateRoomHeader(room);
  msgInput.focus();

  // Aggiunge il bot di benvenuto
  setTimeout(() => {
    displayMessage("NeonBot", `Benvenuto in #${room}, ${name}! 🚀`, new Date().toISOString(), false);
    addUser("NeonBot");
  }, 600);
}

/* ───────────────────────────────────────────
   ROOMS
─────────────────────────────────────────── */
function renderRoomList(active) {
  roomList.innerHTML = "";
  Object.keys(App.rooms).forEach(r => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hash">#</span> ${r}`;
    if (r === active) li.classList.add("active");
    li.addEventListener("click", () => switchRoom(r));
    roomList.appendChild(li);
  });
}

function switchRoom(room) {
  if (room === App.currentRoom) return;
  App.currentRoom = room;
  messages.innerHTML = "";
  updateRoomHeader(room);
  renderRoomList(room);
  addSystemMsg(`Sei entrato in #${room}`);
  if (App.ws) App.ws.send(JSON.stringify({ type:"join_room", room }));
}

function updateRoomHeader(room) {
  currentRoomName.textContent = room;
  roomUsersCount.textContent = `${userList.children.length} utenti`;
}

newRoomBtn.addEventListener("click", () => {
  const name = prompt("Nome della nuova stanza:");
  if (!name || !name.trim()) return;
  const clean = name.trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"");
  if (!clean) return;
  App.rooms[clean] = [];
  renderRoomList(App.currentRoom);
  switchRoom(clean);
});

/* ───────────────────────────────────────────
   USERS
─────────────────────────────────────────── */
function addUser(name) {
  if (document.querySelector(`[data-user="${name}"]`)) return;
  const li = document.createElement("li");
  if (name === App.username) li.classList.add("me");
  li.dataset.user = name;
  const color = App.getColor(name);
  li.innerHTML = `<span class="dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>${name}${name===App.username?" (tu)":""}`;
  userList.appendChild(li);
  roomUsersCount.textContent = `${userList.children.length} utenti`;
}

function removeUser(name) {
  const el = document.querySelector(`[data-user="${name}"]`);
  if (el) el.remove();
  roomUsersCount.textContent = `${userList.children.length} utenti`;
}

/* ───────────────────────────────────────────
   MESSAGES
─────────────────────────────────────────── */
function displayMessage(username, text, timestamp, isMine, animate = true) {
  // Rimuovi welcome msg se c'è
  const welcome = messages.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  const time = new Date(timestamp).toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
  const color = App.getColor(username);
  const initial = username[0].toUpperCase();

  const group = document.createElement("div");
  group.className = `msg-group${isMine ? " own" : ""}`;
  if (!animate) group.style.animation = "none";

  group.innerHTML = `
    <div class="msg-avatar" style="background:linear-gradient(135deg,${color},#0055aa)">${initial}</div>
    <div class="msg-content">
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-bubble">${formatText(escapeHtml(text))}</div>
    </div>`;

  messages.appendChild(group);
  messages.scrollTop = messages.scrollHeight;
}

function addSystemMsg(text) {
  const div = document.createElement("div");
  div.className = "msg-system";
  div.innerHTML = `<span>${escapeHtml(text)}</span>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function formatText(text) {
  // Bold **testo**
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic *testo*
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Code `testo`
  text = text.replace(/`(.*?)`/g, "<code style='background:rgba(0,240,200,0.1);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px'>$1</code>");
  return text;
}

function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

/* ───────────────────────────────────────────
   TYPING INDICATOR
─────────────────────────────────────────── */
const typingUsers = new Set();
function showTyping(name, active) {
  if (active) typingUsers.add(name); else typingUsers.delete(name);
  if (typingUsers.size === 0) {
    typingEl.textContent = "";
  } else {
    const names = [...typingUsers].join(", ");
    typingEl.textContent = `${names} ${typingUsers.size===1?"sta":"stanno"} scrivendo...`;
  }
}

/* ───────────────────────────────────────────
   INVIO MESSAGGI
─────────────────────────────────────────── */
sendBtn.addEventListener("click", doSend);
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
});

function doSend() {
  const text = msgInput.value.trim();
  if (!text) return;
  App.sendMessage(text);
  msgInput.value = "";
  charCount.textContent = "500";
  charCount.className = "char-count";
  sendBtn.disabled = false;
  clearTyping();
}

/* Char counter & typing */
msgInput.addEventListener("input", () => {
  const rem = 500 - msgInput.value.length;
  charCount.textContent = rem;
  charCount.className = "char-count" + (rem < 50 ? " danger" : rem < 100 ? " warn" : "");
  sendBtn.disabled = msgInput.value.trim().length === 0;

  // Typing signal
  if (!App.isTyping && msgInput.value.length > 0) {
    App.isTyping = true;
    App.sendTyping && App.sendTyping(true);
  }
  clearTimeout(App.typingTimer);
  App.typingTimer = setTimeout(clearTyping, 2000);
});

function clearTyping() {
  if (App.isTyping) {
    App.isTyping = false;
    App.sendTyping && App.sendTyping(false);
  }
}

/* ───────────────────────────────────────────
   EMOJI PICKER
─────────────────────────────────────────── */
emojiBtn.addEventListener("click", e => {
  e.stopPropagation();
  emojiPicker.classList.toggle("open");
});
document.addEventListener("click", () => emojiPicker.classList.remove("open"));
emojiPicker.querySelectorAll("span").forEach(el => {
  el.addEventListener("click", () => {
    msgInput.value += el.textContent;
    msgInput.focus();
    const rem = 500 - msgInput.value.length;
    charCount.textContent = rem;
    emojiPicker.classList.remove("open");
  });
});

/* ───────────────────────────────────────────
   ALTRI CONTROLLI
─────────────────────────────────────────── */
clearBtn.addEventListener("click", () => {
  if (confirm("Svuotare la chat?")) {
    messages.innerHTML = "";
    addSystemMsg("Chat svuotata.");
  }
});

logoutBtn.addEventListener("click", () => {
  if (App.channel) {
    App.channel.postMessage({ type:"leave", from: App.username });
    App.channel.close();
  }
  if (App.ws) App.ws.close();
  location.reload();
});

// Disabilita send finché non c'è testo
sendBtn.disabled = true;

// Focus auth input
usernameInput.focus();

/* ═══════════════════════════════════════════════════════════
   AI — NeonBot integration
═══════════════════════════════════════════════════════════ */

// DOM refs AI
const aiDot        = $("ai-dot");
const aiLabel      = $("ai-label");
const aiKeyBtn     = $("ai-key-btn");
const apiModal     = $("api-modal");
const apiKeyInput  = $("api-key-input");
const apiKeySave   = $("api-key-save");
const apiKeyCancel = $("api-key-cancel");
const aiQuickBtn   = $("ai-quick-btn");

let aiActive = false;

// ── Aggiorna stato AI nell'UI ─────────────────────────────
function setAiStatus(ok, message) {
  aiActive = ok;
  if (ok) {
    aiDot.classList.add("active");
    aiLabel.classList.add("active");
    aiLabel.textContent = "NeonBot AI attiva";
    aiQuickBtn.title = "Chiedi all'AI (@ai)";
  } else {
    aiDot.classList.remove("active");
    aiLabel.classList.remove("active");
    aiLabel.textContent = message || "AI non configurata";
    aiQuickBtn.title = "Configura AI prima";
  }
}

// ── Gestisci messaggi server relativi all'AI ─────────────
const _origHandleServerMsg = typeof handleServerMsg !== "undefined" ? handleServerMsg : null;
// Patch: intercetta ai_status nel flusso WS
const _origWSOnMessage = App.ws ? App.ws.onmessage : null;

// Aggiungo il caso ai_status nel parser
const origHandleServerMsg = window._handleServerMsg || function(){};
// Nota: handleServerMsg è già definita in app.js — patchiamo aggiungendo il caso
// Uso un approccio diverso: sovrascriviamo dopo il caricamento
document.addEventListener("DOMContentLoaded", () => {}, {once:true});

// La funzione handleServerMsg originale non copre ai_status — la estendiamo
// tramite proxy sull'App.ws, impostato in initChat
const _origInitChat = window.initChat;

// Hook sul WS: quando viene ricevuto ai_status
function patchWSForAI() {
  if (!App.ws) return;
  const origOnMsg = App.ws.onmessage;
  App.ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === "ai_status") { setAiStatus(d.ok, d.message); return; }
      if (d.type === "message" && d.is_ai) {
        // Rimuovi dalla coda normale — verrà gestita come AI message
        displayMessage(d.username, d.text, d.timestamp, false, true, true);
        return;
      }
    } catch(_) {}
    if (origOnMsg) origOnMsg(e);
  };
}

// ── Modal API Key ─────────────────────────────────────────
function openApiModal() {
  apiModal.classList.add("open");
  apiKeyInput.focus();
}
function closeApiModal() {
  apiModal.classList.remove("open");
}

aiKeyBtn.addEventListener("click", openApiModal);
apiKeyCancel.addEventListener("click", closeApiModal);
apiModal.addEventListener("click", e => { if(e.target === apiModal) closeApiModal(); });
apiKeyInput.addEventListener("keydown", e => { if(e.key === "Enter") saveApiKey(); });
apiKeySave.addEventListener("click", saveApiKey);

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) return;

  if (App.ws && App.ws.readyState === WebSocket.OPEN) {
    App.ws.send(JSON.stringify({ type: "set_api_key", key }));
    addSystemMsg("🔑 Chiave API inviata al server...");
  } else {
    // Offline mode: non c'è server, informa l'utente
    addSystemMsg("⚠ Modalità offline: l'AI richiede il server Python. Avvia server.py e riconnettiti.");
  }
  apiKeyInput.value = "";
  closeApiModal();
}

// ── Pulsante AI rapido nell'input bar ────────────────────
aiQuickBtn.addEventListener("click", () => {
  if (!aiActive) { openApiModal(); return; }
  const cur = msgInput.value.trim();
  if (!cur.toLowerCase().startsWith("@ai")) {
    msgInput.value = "@ai " + cur;
  }
  msgInput.focus();
});

// ── Override displayMessage per messaggi AI ───────────────
const _origDisplayMessage = displayMessage;
// Ridefinisco displayMessage aggiungendo supporto is_ai
window.displayMessage = function(username, text, timestamp, isMine, animate = true, isAI = false) {
  const welcome = messages.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  const time    = new Date(timestamp).toLocaleTimeString("it-IT", { hour:"2-digit", minute:"2-digit" });
  const color   = App.getColor(username);
  const initial = username[0].toUpperCase();

  const group = document.createElement("div");
  group.className = `msg-group${isMine ? " own" : ""}${isAI ? " ai" : ""}`;
  if (!animate) group.style.animation = "none";

  group.innerHTML = `
    <div class="msg-avatar" style="background:linear-gradient(135deg,${color},#0055aa)">${initial}</div>
    <div class="msg-content">
      <div class="msg-meta">
        <span class="msg-author" style="color:${color}">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-bubble">${formatText(escapeHtml(text))}</div>
    </div>`;

  messages.appendChild(group);
  messages.scrollTop = messages.scrollHeight;
};

// ── Mostra AI typing con animazione dots ─────────────────
const _origShowTyping = showTyping;
window.showTyping = function(name, active) {
  if (name === "NeonBot") {
    if (active) {
      typingEl.innerHTML = `<span style="color:var(--neon);font-family:var(--font-mono);font-size:11px">
        ⬡ NeonBot sta elaborando
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </span>`;
      aiQuickBtn.classList.add("loading");
    } else {
      typingEl.textContent = "";
      aiQuickBtn.classList.remove("loading");
    }
    return;
  }
  _origShowTyping(name, active);
};

// ── Hint @ai nell'input ───────────────────────────────────
msgInput.addEventListener("input", () => {
  const val = msgInput.value;
  if (val.startsWith("@ai") || val.startsWith("/ai")) {
    msgInput.style.borderColor = "rgba(0,240,200,0.6)";
    msgInput.style.boxShadow   = "0 0 0 3px rgba(0,240,200,0.12)";
  } else {
    msgInput.style.borderColor = "";
    msgInput.style.boxShadow   = "";
  }
}, { passive: true });

// ── Patcha il WS dopo initChat ────────────────────────────
// Sovrascriviamo App.ws.onmessage non appena viene aperto
const _origInitChatFn = initChat;
window.initChat = function(name, room) {
  _origInitChatFn(name, room);
  // Aspetta che ws sia pronto
  const tryPatch = setInterval(() => {
    if (App.ws && App.ws.onmessage) {
      patchWSForAI();
      clearInterval(tryPatch);
    }
  }, 100);
  // Timeout
  setTimeout(() => clearInterval(tryPatch), 5000);
};