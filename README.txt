╔══════════════════════════════════════════════════════════════╗
║                  NeonChat — Documentazione                   ║
║          App di Messaggistica Multi-Backend v1.0             ║
╚══════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PANORAMICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NeonChat è un'app di messaggistica in tempo reale con frontend
cyberpunk/neon e tre opzioni di backend intercambiabili:

  • Python  (WebSocket via asyncio + websockets)
  • PHP     (REST long-polling o Ratchet WebSocket)
  • C++     (Boost.Beast WebSocket ad alte prestazioni)

Il frontend funziona ANCHE in modalità offline/demo usando
BroadcastChannel API del browser (multi-tab nella stessa macchina).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FILE DEL PROGETTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  index.html   —  UI principale (HTML5 semantico)
  style.css    —  Tema neon/cyberpunk, animazioni, responsive
  app.js       —  Logica client: WebSocket, BroadcastChannel,
                  typing indicator, emoji picker, markdown lite
  server.py    —  Backend Python (asyncio + websockets)
  server.php   —  Backend PHP (REST API + opzione Ratchet WS)
  server.cpp   —  Backend C++ (Boost.Beast, multi-thread)
  README.txt   —  Questo file

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AVVIO RAPIDO — MODALITÀ DEMO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Apri index.html nel browser (doppio click o via live server)
  2. Inserisci un nickname e premi CONNETTI
  3. Apri un'altra scheda con lo stesso file → secondo utente!
  I messaggi tra schede funzionano via BroadcastChannel (offline).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AVVIO CON SERVER PYTHON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Requisiti:
    Python 3.9+
    pip install websockets

  Comandi:
    python server.py               # porta 8765
    python server.py --port 9000   # porta custom
    python server.py --host 0.0.0.0 --port 8765  # rete locale

  Poi apri index.html — si connetterà automaticamente a ws://localhost:8765

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AVVIO CON SERVER PHP (REST)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Requisiti:
    PHP 8.1+  (nessuna dipendenza extra per la modalità REST)

  Comandi:
    php -S localhost:8080 server.php

  NOTA: La modalità REST usa long-polling (non WebSocket puro).
  Per WebSocket via PHP, installa Ratchet:
    composer require cboden/ratchet
  E decommenta il blocco finale di server.php salvandolo come
  server_ws.php, poi:
    php server_ws.php 8765

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  COMPILAZIONE SERVER C++
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Requisiti:
    g++ 17+, Boost 1.74+, nlohmann/json

  Ubuntu/Debian:
    sudo apt install libboost-all-dev nlohmann-json3-dev
    g++ -std=c++17 -O2 server.cpp -o neonchat -lboost_system -lpthread
    ./neonchat 8765

  macOS (Homebrew):
    brew install boost nlohmann-json
    g++ -std=c++17 -O2 server.cpp -o neonchat \
        -I$(brew --prefix boost)/include \
        -I$(brew --prefix nlohmann-json)/include \
        -L$(brew --prefix boost)/lib -lboost_system -lpthread
    ./neonchat 8765

  Windows (vcpkg):
    vcpkg install boost-beast nlohmann-json
    cl /std:c++17 /O2 server.cpp /Fe:neonchat.exe
    neonchat.exe 8765

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FUNZIONALITÀ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✔  Chat in tempo reale via WebSocket
  ✔  Stanze multiple (crea stanze personalizzate)
  ✔  Indicatore "sta scrivendo..."
  ✔  Avatar colorati generati dal nickname
  ✔  Emoji picker integrato
  ✔  Markdown leggero (**grassetto**, *corsivo*, `codice`)
  ✔  Contatore caratteri in tempo reale
  ✔  Storia messaggi (ultima sessione)
  ✔  Modalità offline multi-tab (BroadcastChannel)
  ✔  Design responsive (mobile friendly)
  ✔  Effetti neon, scanline e animazioni CSS
  ✔  Notifiche entrata/uscita utenti

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PROTOCOLLO WEBSOCKET (messaggi JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Client → Server:
    { "type": "join",     "username": "Alice", "room": "generale" }
    { "type": "message",  "text": "ciao!" }
    { "type": "typing",   "active": true }
    { "type": "join_room","room": "tech" }

  Server → Client:
    { "type": "history",  "messages": [...] }
    { "type": "users",    "users": ["Alice","Bob"] }
    { "type": "join",     "username": "Bob" }
    { "type": "leave",    "username": "Bob" }
    { "type": "message",  "username":"Alice","text":"ciao!","timestamp":"..." }
    { "type": "typing",   "username": "Bob", "active": true }
    { "type": "error",    "message": "Nickname non valido" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SICUREZZA (produzione)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠  Usa HTTPS/WSS in produzione (nginx + Let's Encrypt)
  ⚠  Aggiungi autenticazione (JWT o sessioni server-side)
  ⚠  Implementa rate limiting per evitare spam
  ⚠  Valida e sanitizza tutti i dati lato server
  ⚠  Considera crittografia end-to-end (Web Crypto API)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  LICENZA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MIT — Libero per uso personale e commerciale.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TECNOLOGIE USATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Frontend:  HTML5, CSS3, Vanilla JS (ES2022), BroadcastChannel API
  Fonts:     Share Tech Mono, Exo 2 (Google Fonts)
  Python:    asyncio, websockets 11+
  PHP:       PHP 8.1, Ratchet (opzionale)
  C++:       C++17, Boost.Beast, Boost.Asio, nlohmann/json

╔══════════════════════════════════════════════════════════════╗
║  Creato con NeonChat Generator · Buona fortuna! ⬡            ║
╚══════════════════════════════════════════════════════════════╝
