#!/usr/bin/env python3
"""
NeonChat — server.py
HTTP statico  →  http://localhost:8080
WebSocket     →  ws://localhost:8765

Dipendenze:
    pip install websockets anthropic

Avvio:
    python server.py

Poi apri:  http://localhost:8080

L'AI risponde quando un messaggio inizia con  @ai  oppure  /ai
La chiave API viene letta da:
  1. Variabile d'ambiente  ANTHROPIC_API_KEY
  2. Oppure inviata dal client nel messaggio { type:"set_api_key", key:"..." }
"""

import asyncio, json, logging, argparse, mimetypes, os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

import websockets

# Anthropic SDK (opzionale ma raccomandato)
try:
    import anthropic as anthropic_sdk
    HAS_SDK = True
except ImportError:
    HAS_SDK = False

# Fallback: urllib puro (zero dipendenze extra)
import urllib.request, urllib.error

# ─── Logging ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("NeonChat")

STATIC_DIR = Path(__file__).parent.resolve()

# ═══════════════════════════════════════════
#  HTTP STATICO
# ═══════════════════════════════════════════

async def http_handler(reader, writer):
    try:
        line = await asyncio.wait_for(reader.readline(), timeout=5)
        if not line: return
        parts = line.decode(errors="replace").strip().split()
        if len(parts) < 2: return
        method, path = parts[0], parts[1]
        while True:
            h = await asyncio.wait_for(reader.readline(), timeout=5)
            if h in (b"\r\n", b"\n", b""): break

        path = path.split("?")[0]
        if path == "/": path = "/index.html"
        try:
            target = (STATIC_DIR / path.lstrip("/")).resolve()
            target.relative_to(STATIC_DIR)
        except Exception:
            writer.write(b"HTTP/1.1 403 Forbidden\r\n\r\n"); await writer.drain(); return

        if method != "GET" or not target.is_file():
            body = b"404 Not Found"
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: " +
                         str(len(body)).encode() + b"\r\n\r\n" + body)
            await writer.drain(); return

        mime, _ = mimetypes.guess_type(str(target))
        data = target.read_bytes()
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: " + (mime or "application/octet-stream").encode() +
                     b"\r\nContent-Length: " + str(len(data)).encode() +
                     b"\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n\r\n" + data)
        await writer.drain()
    except Exception as e:
        log.debug(f"HTTP: {e}")
    finally:
        try: writer.close(); await writer.wait_closed()
        except: pass

# ═══════════════════════════════════════════
#  AI — chiama Claude via SDK o urllib
# ═══════════════════════════════════════════

# Cronologia conversazioni per stanza: room → list of {role, content}
ai_histories: Dict[str, list] = {}
# Chiave API per stanza (impostata dal client)
room_api_keys: Dict[str, str] = {}

SYSTEM_PROMPT = """Sei NeonBot, un assistente AI integrato in NeonChat, 
una app di messaggistica con estetica cyberpunk. Rispondi in italiano 
a meno che l'utente scriva in un'altra lingua. Sii conciso, utile e 
leggermente "tech". Non usare markdown eccessivo — il testo viene 
mostrato in una chat. Massimo 3-4 frasi per risposta salvo richieste 
di spiegazioni lunghe."""

async def call_claude(room: str, user_msg: str, api_key: str) -> str:
    """Chiama l'API Anthropic e restituisce la risposta testuale."""
    hist = ai_histories.setdefault(room, [])
    hist.append({"role": "user", "content": user_msg})
    # Mantieni al massimo 20 scambi
    if len(hist) > 40:
        hist[:] = hist[-40:]

    loop = asyncio.get_event_loop()

    def _sync_call():
        if HAS_SDK:
            client = anthropic_sdk.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=hist,
            )
            return resp.content[0].text
        else:
            # Fallback urllib
            payload = json.dumps({
                "model": "claude-opus-4-6",
                "max_tokens": 1024,
                "system": SYSTEM_PROMPT,
                "messages": hist,
            }).encode()
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=payload,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                body = json.loads(r.read())
                return body["content"][0]["text"]

    try:
        text = await loop.run_in_executor(None, _sync_call)
        hist.append({"role": "assistant", "content": text})
        return text
    except Exception as e:
        log.warning(f"AI error: {e}")
        hist.pop()  # rimuovi il messaggio non risposto
        return f"⚠ Errore AI: {e}"

# ═══════════════════════════════════════════
#  STATO CHAT
# ═══════════════════════════════════════════

class ChatServer:
    def __init__(self):
        self.rooms:   Dict[str, set]     = {}
        self.clients: Dict[object, dict] = {}
        self.history: Dict[str, list]    = {}

    def get_room(self, name):
        if name not in self.rooms:
            self.rooms[name] = set(); self.history[name] = []
        return self.rooms[name]

    def users_in_room(self, room):
        return [i["username"] for i in self.clients.values() if i.get("room") == room]

    async def broadcast(self, room, message, exclude=None):
        payload = json.dumps(message)
        tasks = [ws.send(payload) for ws in list(self.get_room(room)) if ws is not exclude]
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)

    async def send_to(self, ws, message):
        try: await ws.send(json.dumps(message))
        except: pass

    def add_history(self, room, msg):
        h = self.history.setdefault(room, [])
        h.append(msg)
        if len(h) > 100: h.pop(0)

chat = ChatServer()

# ═══════════════════════════════════════════
#  HANDLER WEBSOCKET
# ═══════════════════════════════════════════

async def ws_handler(ws):
    log.info(f"WS connesso: {ws.remote_address}")
    try:
        async for raw in ws:
            try: data = json.loads(raw)
            except: continue
            t = data.get("type")

            # ── SET API KEY ──────────────────────────────
            if t == "set_api_key":
                if ws in chat.clients:
                    room = chat.clients[ws]["room"]
                    key  = str(data.get("key", "")).strip()
                    if key:
                        room_api_keys[room] = key
                        log.info(f"  API key impostata per #{room}")
                        await chat.send_to(ws, {"type": "ai_status", "ok": True,
                            "message": "✅ Chiave API salvata. Scrivi @ai <domanda> per chattare con Claude!"})
                    else:
                        await chat.send_to(ws, {"type": "ai_status", "ok": False,
                            "message": "⚠ Chiave API non valida."})
                continue

            # ── JOIN ─────────────────────────────────────
            if t == "join":
                username = str(data.get("username", "Anonimo"))[:20].strip()
                room     = str(data.get("room", "generale"))[:30].strip() or "generale"
                if not username:
                    await chat.send_to(ws, {"type":"error","message":"Nickname non valido"}); continue

                if ws in chat.clients:
                    old = chat.clients[ws]
                    chat.rooms.get(old["room"], set()).discard(ws)
                    await chat.broadcast(old["room"], {"type":"leave","username":old["username"]}, exclude=ws)

                chat.clients[ws] = {"username": username, "room": room}
                chat.get_room(room).add(ws)
                log.info(f"  {username} → #{room}")

                await chat.send_to(ws, {"type":"history","messages": chat.history.get(room,[])})
                await chat.send_to(ws, {"type":"users","users": chat.users_in_room(room)})
                await chat.broadcast(room, {"type":"join","username":username}, exclude=ws)

                # Informa se AI è disponibile
                has_key = bool(room_api_keys.get(room) or os.getenv("ANTHROPIC_API_KEY"))
                await chat.send_to(ws, {"type":"ai_status","ok": has_key,
                    "message": "✅ AI attiva — scrivi @ai <domanda>" if has_key
                               else "ℹ Digita /apikey <chiave> per attivare l'AI"})

            # ── MESSAGE ──────────────────────────────────
            elif t == "message" and ws in chat.clients:
                text = str(data.get("text","")).strip()[:500]
                if not text: continue
                info = chat.clients[ws]
                room = info["room"]

                msg = {
                    "type": "message", "username": info["username"],
                    "text": text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                chat.add_history(room, msg)
                await chat.broadcast(room, msg)

                # ── Trigger AI ──────────────────────────
                ai_trigger = None
                low = text.strip().lower()
                if low.startswith("@ai "):
                    ai_trigger = text[4:].strip()
                elif low.startswith("/ai "):
                    ai_trigger = text[4:].strip()
                elif low == "@ai" or low == "/ai":
                    ai_trigger = "Ciao! Come puoi aiutarmi?"

                if ai_trigger:
                    api_key = room_api_keys.get(room) or os.getenv("ANTHROPIC_API_KEY", "")
                    if not api_key:
                        await chat.broadcast(room, {
                            "type": "message", "username": "NeonBot",
                            "text": "⚠ Nessuna chiave API configurata. Scrivi /apikey <tua_chiave> per attivarmi!",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                    else:
                        # Mostra "sta scrivendo..."
                        await chat.broadcast(room, {"type":"typing","username":"NeonBot","active":True})
                        ai_reply = await call_claude(room, ai_trigger, api_key)
                        await chat.broadcast(room, {"type":"typing","username":"NeonBot","active":False})
                        ai_msg = {
                            "type": "message", "username": "NeonBot",
                            "text": ai_reply,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "is_ai": True,
                        }
                        chat.add_history(room, ai_msg)
                        await chat.broadcast(room, ai_msg)

                # ── Comando /apikey ──────────────────────
                if low.startswith("/apikey "):
                    key = text[8:].strip()
                    room_api_keys[room] = key
                    log.info(f"  API key impostata via comando per #{room}")
                    await chat.broadcast(room, {
                        "type": "message", "username": "Sistema",
                        "text": "🔑 Chiave API salvata per questa stanza. Scrivi @ai <domanda> per usare Claude!",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

            # ── TYPING ───────────────────────────────────
            elif t == "typing" and ws in chat.clients:
                info = chat.clients[ws]
                await chat.broadcast(info["room"], {
                    "type":"typing","username":info["username"],"active":bool(data.get("active"))
                }, exclude=ws)

            # ── JOIN_ROOM ────────────────────────────────
            elif t == "join_room" and ws in chat.clients:
                new_room = str(data.get("room","generale"))[:30].strip() or "generale"
                info = chat.clients[ws]; old_room = info["room"]
                chat.rooms.get(old_room, set()).discard(ws)
                await chat.broadcast(old_room, {"type":"leave","username":info["username"]})
                info["room"] = new_room
                chat.get_room(new_room).add(ws)
                await chat.send_to(ws, {"type":"history","messages": chat.history.get(new_room,[])})
                await chat.send_to(ws, {"type":"users","users": chat.users_in_room(new_room)})
                await chat.broadcast(new_room, {"type":"join","username":info["username"]}, exclude=ws)

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        log.debug(f"WS error: {e}")
    finally:
        if ws in chat.clients:
            info = chat.clients.pop(ws)
            chat.rooms.get(info["room"], set()).discard(ws)
            await chat.broadcast(info["room"], {"type":"leave","username":info["username"]})
            log.info(f"  {info['username']} disconnesso")

# ═══════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════

async def main(http_port, ws_port, host):
    http_server = await asyncio.start_server(http_handler, host, http_port)
    ws_server   = await websockets.serve(ws_handler, host, ws_port,
                                         ping_interval=30, ping_timeout=10)
    env_key = os.getenv("ANTHROPIC_API_KEY")
    log.info("=" * 52)
    log.info("  NeonChat + AI avviato!")
    log.info(f"  >>> http://localhost:{http_port} <<<")
    log.info(f"  WebSocket: ws://localhost:{ws_port}")
    log.info(f"  AI (Anthropic): {'✅ chiave trovata in env' if env_key else '⚠  imposta ANTHROPIC_API_KEY o usa /apikey'}")
    log.info("  Trigger AI in chat: @ai <domanda>")
    log.info("=" * 52)
    async with http_server, ws_server:
        await asyncio.Future()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host",      default="localhost")
    parser.add_argument("--http-port", type=int, default=8080)
    parser.add_argument("--ws-port",   type=int, default=8765)
    args = parser.parse_args()
    try:
        asyncio.run(main(args.http_port, args.ws_port, args.host))
    except KeyboardInterrupt:
        log.info("Server fermato.")