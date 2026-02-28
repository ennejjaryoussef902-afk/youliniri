<?php
/**
 * NeonChat — server.php
 * Backend PHP con Ratchet (WebSocket) e API REST come alternativa.
 *
 * INSTALLAZIONE:
 *   composer require cboden/ratchet
 *
 * AVVIO:
 *   php server.php
 *
 * API REST (fallback senza WebSocket):
 *   GET  /api/messages?room=generale&since=timestamp
 *   POST /api/messages  { username, room, text }
 *   GET  /api/users?room=generale
 */

declare(strict_types=1);

// ─── Modalità: rileva se stiamo usando Ratchet o pure API ─
define('BASE_DIR', __DIR__);
define('DATA_DIR', BASE_DIR . '/data');
define('MSG_FILE', DATA_DIR . '/messages.json');
define('USER_FILE', DATA_DIR . '/users.json');
define('MAX_MSGS',  200);
define('MAX_TEXT',  500);
define('TTL_USER',  30);   // secondi prima che un utente sia considerato offline

// Crea directory dati se non esiste
if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);

/* ═══════════════════════════════════════════════════════════
   SEZIONE REST API (PHP senza WebSocket — long-polling)
═══════════════════════════════════════════════════════════ */

// Headers CORS per lo sviluppo locale
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// ── Router ─────────────────────────────────────────────
if ($method === 'GET' && str_ends_with($uri, '/api/messages')) {
    apiGetMessages();
} elseif ($method === 'POST' && str_ends_with($uri, '/api/messages')) {
    apiPostMessage();
} elseif ($method === 'GET' && str_ends_with($uri, '/api/users')) {
    apiGetUsers();
} elseif ($method === 'POST' && str_ends_with($uri, '/api/heartbeat')) {
    apiHeartbeat();
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Endpoint non trovato']);
}

/* ─── Helpers ─────────────────────────────────────────── */
function readJson(string $file): array {
    if (!file_exists($file)) return [];
    $content = file_get_contents($file);
    return json_decode($content, true) ?: [];
}

function writeJson(string $file, array $data): void {
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function sanitize(string $text, int $max = 200): string {
    return htmlspecialchars(trim(substr($text, 0, $max)), ENT_QUOTES, 'UTF-8');
}

function now(): string {
    return (new DateTime('now', new DateTimeZone('UTC')))->format('c');
}

/* ─── GET /api/messages ────────────────────────────────── */
function apiGetMessages(): void {
    $room  = sanitize($_GET['room'] ?? 'generale', 50);
    $since = $_GET['since'] ?? null;

    $all  = readJson(MSG_FILE);
    $msgs = array_filter($all, fn($m) => $m['room'] === $room);

    if ($since) {
        $msgs = array_filter($msgs, fn($m) => $m['timestamp'] > $since);
    }

    echo json_encode(['messages' => array_values($msgs), 'room' => $room]);
}

/* ─── POST /api/messages ───────────────────────────────── */
function apiPostMessage(): void {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!$body) {
        http_response_code(400);
        echo json_encode(['error' => 'Body JSON non valido']);
        return;
    }

    $username = sanitize($body['username'] ?? '', 20);
    $room     = sanitize($body['room'] ?? 'generale', 50);
    $text     = sanitize($body['text'] ?? '', MAX_TEXT);

    if (!$username || strlen($username) < 2) {
        http_response_code(422);
        echo json_encode(['error' => 'Username non valido']);
        return;
    }
    if (!$text) {
        http_response_code(422);
        echo json_encode(['error' => 'Messaggio vuoto']);
        return;
    }

    $msg = [
        'id'        => uniqid('msg_', true),
        'username'  => $username,
        'room'      => $room,
        'text'      => $text,
        'timestamp' => now(),
    ];

    $all = readJson(MSG_FILE);
    $all[] = $msg;

    // Mantieni solo gli ultimi MAX_MSGS messaggi per stanza
    $roomMsgs = array_filter($all, fn($m) => $m['room'] === $room);
    if (count($roomMsgs) > MAX_MSGS) {
        $otherMsgs = array_filter($all, fn($m) => $m['room'] !== $room);
        $roomMsgs  = array_slice(array_values($roomMsgs), -MAX_MSGS);
        $all       = array_merge(array_values($otherMsgs), $roomMsgs);
    }

    writeJson(MSG_FILE, $all);

    http_response_code(201);
    echo json_encode($msg);
}

/* ─── GET /api/users ───────────────────────────────────── */
function apiGetUsers(): void {
    $room = sanitize($_GET['room'] ?? 'generale', 50);
    $all  = readJson(USER_FILE);
    $cutoff = time() - TTL_USER;

    $online = array_filter(
        $all,
        fn($u) => $u['room'] === $room && $u['last_seen'] >= $cutoff
    );

    echo json_encode(['users' => array_values(array_map(fn($u) => $u['username'], $online))]);
}

/* ─── POST /api/heartbeat ──────────────────────────────── */
function apiHeartbeat(): void {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!$body) { http_response_code(400); return; }

    $username = sanitize($body['username'] ?? '', 20);
    $room     = sanitize($body['room'] ?? 'generale', 50);
    if (!$username) { http_response_code(422); return; }

    $all = readJson(USER_FILE);

    // Aggiorna o inserisci
    $found = false;
    foreach ($all as &$u) {
        if ($u['username'] === $username && $u['room'] === $room) {
            $u['last_seen'] = time();
            $found = true;
            break;
        }
    }
    if (!$found) {
        $all[] = ['username' => $username, 'room' => $room, 'last_seen' => time()];
    }

    writeJson(USER_FILE, $all);
    echo json_encode(['ok' => true]);
}

/* ═══════════════════════════════════════════════════════════
   SEZIONE RATCHET WEBSOCKET (richiede composer)
   Decommenta e usa `php server_ws.php` per avviarlo.
═══════════════════════════════════════════════════════════

// Salva questo blocco come server_ws.php

require 'vendor/autoload.php';

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;

class NeonChatWS implements MessageComponentInterface {
    protected array $rooms  = [];   // room → [conn, ...]
    protected array $clients = [];  // connId → [username, room]
    protected array $history = [];  // room → [msgs]

    public function onOpen(ConnectionInterface $conn): void {
        echo "Nuova connessione: {$conn->resourceId}\n";
    }

    public function onMessage(ConnectionInterface $from, $raw): void {
        $data = json_decode($raw, true);
        if (!$data) return;

        $id = $from->resourceId;

        match ($data['type'] ?? '') {
            'join'    => $this->handleJoin($from, $data),
            'message' => $this->handleMessage($from, $data),
            'typing'  => $this->handleTyping($from, $data),
            default   => null,
        };
    }

    protected function handleJoin(ConnectionInterface $conn, array $data): void {
        $username = substr(trim($data['username'] ?? ''), 0, 20);
        $room     = substr(trim($data['room'] ?? 'generale'), 0, 30) ?: 'generale';

        $id = $conn->resourceId;
        $this->clients[$id] = compact('username', 'room');
        $this->rooms[$room]  ??= new \SplObjectStorage();
        $this->rooms[$room]->attach($conn);

        // Manda storia
        $conn->send(json_encode(['type'=>'history','messages'=>$this->history[$room] ?? []]));

        // Manda utenti
        $conn->send(json_encode(['type'=>'users','users'=>$this->usersIn($room)]));

        // Broadcast join
        $this->broadcast($room, ['type'=>'join','username'=>$username], $conn);
    }

    protected function handleMessage(ConnectionInterface $from, array $data): void {
        $id   = $from->resourceId;
        $info = $this->clients[$id] ?? null;
        if (!$info) return;

        $text = substr(trim($data['text'] ?? ''), 0, 500);
        if (!$text) return;

        $msg = [
            'type'      => 'message',
            'username'  => $info['username'],
            'text'      => $text,
            'timestamp' => (new DateTime('now', new DateTimeZone('UTC')))->format('c'),
        ];

        $room = $info['room'];
        $this->history[$room][] = $msg;
        if (count($this->history[$room]) > 100) array_shift($this->history[$room]);

        $this->broadcast($room, $msg);
    }

    protected function handleTyping(ConnectionInterface $from, array $data): void {
        $id   = $from->resourceId;
        $info = $this->clients[$id] ?? null;
        if (!$info) return;

        $this->broadcast($info['room'], [
            'type'     => 'typing',
            'username' => $info['username'],
            'active'   => (bool)($data['active'] ?? false),
        ], $from);
    }

    protected function broadcast(string $room, array $msg, ConnectionInterface $exclude = null): void {
        $storage = $this->rooms[$room] ?? null;
        if (!$storage) return;
        $payload = json_encode($msg);
        foreach ($storage as $conn) {
            if ($conn !== $exclude) $conn->send($payload);
        }
    }

    protected function usersIn(string $room): array {
        return array_column(
            array_filter($this->clients, fn($c) => $c['room'] === $room),
            'username'
        );
    }

    public function onClose(ConnectionInterface $conn): void {
        $id   = $conn->resourceId;
        $info = $this->clients[$id] ?? null;
        if ($info) {
            $this->rooms[$info['room']]?->detach($conn);
            $this->broadcast($info['room'], ['type'=>'leave','username'=>$info['username']]);
            unset($this->clients[$id]);
        }
    }

    public function onError(ConnectionInterface $conn, \Exception $e): void {
        echo "Errore: {$e->getMessage()}\n";
        $conn->close();
    }
}

$port = (int)($argv[1] ?? 8765);
echo "NeonChat WS Server avviato sulla porta {$port}\n";

$server = IoServer::factory(
    new HttpServer(new WsServer(new NeonChatWS())),
    $port
);
$server->run();
*/
