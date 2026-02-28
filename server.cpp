/**
 * NeonChat — server.cpp
 * Server WebSocket ad alte prestazioni in C++17.
 *
 * DIPENDENZE:
 *   - Boost.Beast (WebSocket) + Boost.Asio
 *   - nlohmann/json
 *
 * COMPILAZIONE:
 *   g++ -std=c++17 -O2 server.cpp -o neonchat \
 *       -lboost_system -lpthread -I/usr/include
 *
 *   Oppure con vcpkg:
 *   vcpkg install boost-beast nlohmann-json
 *   cmake -DCMAKE_TOOLCHAIN_FILE=vcpkg/scripts/buildsystems/vcpkg.cmake ..
 *
 * AVVIO:
 *   ./neonchat [porta]     # default: 8765
 */

#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <ctime>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace beast     = boost::beast;
namespace http      = beast::http;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;
using json          = nlohmann::json;

/* ═══════════════════════════════════════════
   STRUTTURE DATI
═══════════════════════════════════════════ */

struct Message {
    std::string id;
    std::string username;
    std::string room;
    std::string text;
    std::string timestamp;
};

inline std::string nowISO() {
    auto now  = std::chrono::system_clock::now();
    auto tt   = std::chrono::system_clock::to_time_t(now);
    char buf[30];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&tt));
    return std::string(buf);
}

inline std::string genId() {
    static std::atomic<uint64_t> counter{0};
    return "msg_" + std::to_string(++counter);
}

/* ═══════════════════════════════════════════
   SESSION WebSocket
═══════════════════════════════════════════ */

class ChatRoom;
class Session;

// Forward declaration
using SessionPtr = std::shared_ptr<Session>;

class Session : public std::enable_shared_from_this<Session> {
public:
    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;
    std::string username_;
    std::string room_name_;
    std::mutex  write_mutex_;
    std::vector<std::string> write_queue_;
    bool writing_ = false;

    explicit Session(tcp::socket&& sock)
        : ws_(std::move(sock)) {}

    void run();
    void on_accept(beast::error_code ec);
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes);
    void handle_message(const json& data);
    void send(const std::string& msg);
    void do_write();
    void on_write(beast::error_code ec, std::size_t bytes);
    void on_close();
};

/* ═══════════════════════════════════════════
   CHAT ROOM MANAGER
═══════════════════════════════════════════ */

class RoomManager {
public:
    std::mutex mutex_;
    std::map<std::string, std::set<SessionPtr>>  rooms_;
    std::map<std::string, std::vector<Message>>  history_;   // max 100 per stanza

    void join(const std::string& room, SessionPtr session) {
        std::lock_guard<std::mutex> lock(mutex_);
        rooms_[room].insert(session);
    }

    void leave(const std::string& room, SessionPtr session) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& members = rooms_[room];
        members.erase(session);
        if (members.empty()) rooms_.erase(room);
    }

    void broadcast(const std::string& room, const std::string& msg, SessionPtr exclude = nullptr) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = rooms_.find(room);
        if (it == rooms_.end()) return;
        for (auto& s : it->second) {
            if (s != exclude) s->send(msg);
        }
    }

    void send_to(SessionPtr session, const json& j) {
        session->send(j.dump());
    }

    std::vector<std::string> users_in(const std::string& room) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<std::string> result;
        auto it = rooms_.find(room);
        if (it != rooms_.end()) {
            for (auto& s : it->second)
                if (!s->username_.empty()) result.push_back(s->username_);
        }
        return result;
    }

    void add_history(const std::string& room, const Message& msg) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& h = history_[room];
        h.push_back(msg);
        if (h.size() > 100) h.erase(h.begin());
    }

    std::vector<Message> get_history(const std::string& room) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = history_.find(room);
        return (it != history_.end()) ? it->second : std::vector<Message>{};
    }
};

static RoomManager g_rooms;

/* ═══════════════════════════════════════════
   SESSION — implementazione
═══════════════════════════════════════════ */

void Session::run() {
    ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
    ws_.set_option(websocket::stream_base::decorator([](websocket::response_type& res) {
        res.set(http::field::server, "NeonChat/1.0");
    }));
    ws_.async_accept(
        beast::bind_front_handler(&Session::on_accept, shared_from_this()));
}

void Session::on_accept(beast::error_code ec) {
    if (ec) { std::cerr << "accept: " << ec.message() << "\n"; return; }
    do_read();
}

void Session::do_read() {
    ws_.async_read(buffer_,
        beast::bind_front_handler(&Session::on_read, shared_from_this()));
}

void Session::on_read(beast::error_code ec, std::size_t) {
    if (ec == websocket::error::closed || ec == net::error::connection_reset) {
        on_close(); return;
    }
    if (ec) { std::cerr << "read: " << ec.message() << "\n"; on_close(); return; }

    std::string raw = beast::buffers_to_string(buffer_.data());
    buffer_.consume(buffer_.size());

    try {
        json data = json::parse(raw);
        handle_message(data);
    } catch (...) {
        // JSON non valido — ignora
    }

    do_read();
}

void Session::handle_message(const json& data) {
    std::string type = data.value("type", "");

    // ── JOIN ─────────────────────────────────────────────
    if (type == "join") {
        username_  = data.value("username", "Anonimo").substr(0, 20);
        room_name_ = data.value("room", "generale").substr(0, 30);
        if (room_name_.empty()) room_name_ = "generale";

        g_rooms.join(room_name_, shared_from_this());

        // Invia storia
        auto hist = g_rooms.get_history(room_name_);
        json h_arr = json::array();
        for (auto& m : hist) {
            h_arr.push_back({
                {"type","message"},{"username",m.username},
                {"text",m.text},{"timestamp",m.timestamp}
            });
        }
        send(json{{"type","history"},{"messages",h_arr}}.dump());

        // Invia utenti
        auto users = g_rooms.users_in(room_name_);
        send(json{{"type","users"},{"users",users}}.dump());

        // Notifica agli altri
        g_rooms.broadcast(room_name_,
            json{{"type","join"},{"username",username_}}.dump(),
            shared_from_this());

        std::cout << "[+] " << username_ << " → #" << room_name_ << "\n";
    }

    // ── MESSAGE ──────────────────────────────────────────
    else if (type == "message" && !username_.empty()) {
        std::string text = data.value("text","").substr(0, 500);
        if (text.empty()) return;

        Message msg;
        msg.id        = genId();
        msg.username  = username_;
        msg.room      = room_name_;
        msg.text      = text;
        msg.timestamp = nowISO();

        g_rooms.add_history(room_name_, msg);
        g_rooms.broadcast(room_name_, json{
            {"type","message"},{"username",msg.username},
            {"text",msg.text},{"timestamp",msg.timestamp}
        }.dump());
    }

    // ── TYPING ───────────────────────────────────────────
    else if (type == "typing" && !username_.empty()) {
        bool active = data.value("active", false);
        g_rooms.broadcast(room_name_, json{
            {"type","typing"},{"username",username_},{"active",active}
        }.dump(), shared_from_this());
    }
}

void Session::send(const std::string& msg) {
    std::lock_guard<std::mutex> lock(write_mutex_);
    write_queue_.push_back(msg);
    if (!writing_) do_write();
}

void Session::do_write() {
    if (write_queue_.empty()) { writing_ = false; return; }
    writing_ = true;
    auto msg = std::make_shared<std::string>(write_queue_.front());
    write_queue_.erase(write_queue_.begin());
    ws_.async_write(net::buffer(*msg),
        [self = shared_from_this(), msg](beast::error_code ec, std::size_t bytes) {
            self->on_write(ec, bytes);
        });
}

void Session::on_write(beast::error_code ec, std::size_t) {
    if (ec) { std::cerr << "write: " << ec.message() << "\n"; on_close(); return; }
    std::lock_guard<std::mutex> lock(write_mutex_);
    do_write();
}

void Session::on_close() {
    if (!username_.empty()) {
        std::cout << "[-] " << username_ << " disconnesso da #" << room_name_ << "\n";
        g_rooms.broadcast(room_name_, json{{"type","leave"},{"username",username_}}.dump());
        g_rooms.leave(room_name_, shared_from_this());
        username_.clear();
    }
}

/* ═══════════════════════════════════════════
   LISTENER
═══════════════════════════════════════════ */

class Listener : public std::enable_shared_from_this<Listener> {
    net::io_context& ioc_;
    tcp::acceptor    acceptor_;

public:
    Listener(net::io_context& ioc, tcp::endpoint endpoint)
        : ioc_(ioc), acceptor_(ioc) {
        acceptor_.open(endpoint.protocol());
        acceptor_.set_option(net::socket_base::reuse_address(true));
        acceptor_.bind(endpoint);
        acceptor_.listen(net::socket_base::max_listen_connections);
    }

    void run() { do_accept(); }

private:
    void do_accept() {
        acceptor_.async_accept(net::make_strand(ioc_),
            beast::bind_front_handler(&Listener::on_accept, shared_from_this()));
    }

    void on_accept(beast::error_code ec, tcp::socket socket) {
        if (!ec) {
            std::make_shared<Session>(std::move(socket))->run();
        }
        do_accept();
    }
};

/* ═══════════════════════════════════════════
   MAIN
═══════════════════════════════════════════ */

int main(int argc, char* argv[]) {
    uint16_t port = (argc > 1) ? static_cast<uint16_t>(std::stoi(argv[1])) : 8765;
    auto threads  = std::max(1u, std::thread::hardware_concurrency());

    std::cout << "╔══════════════════════════════════╗\n";
    std::cout << "║   NeonChat C++ Server v1.0       ║\n";
    std::cout << "╠══════════════════════════════════╣\n";
    std::cout << "║  Porta:   " << port << std::string(21 - std::to_string(port).size(), ' ') << "║\n";
    std::cout << "║  Thread:  " << threads << std::string(22 - std::to_string(threads).size(), ' ') << "║\n";
    std::cout << "╚══════════════════════════════════╝\n";

    net::io_context ioc{static_cast<int>(threads)};

    std::make_shared<Listener>(
        ioc, tcp::endpoint{net::ip::make_address("0.0.0.0"), port}
    )->run();

    // Pool di thread
    std::vector<std::thread> v;
    v.reserve(threads - 1);
    for (auto i = threads - 1; i > 0; --i) {
        v.emplace_back([&ioc] { ioc.run(); });
    }
    ioc.run();

    for (auto& t : v) t.join();
    return 0;
}
