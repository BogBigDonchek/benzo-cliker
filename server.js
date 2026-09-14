const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "game.html")));

const world = {
  adminMessage: "", adminMessageAt: 0,
  event: null, bgPreset: "default", bgCustom: null,
  banned: {}, leaderboard: {}, lastAbuse: null
};

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) try { c.send(msg); } catch(e){} });
}
function broadcastToAdmins(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1 && c.isAdmin) try { c.send(msg); } catch(e){} });
}
function cleanLB() {
  const arr = Object.entries(world.leaderboard).map(([id,d])=>({id,...d}))
    .sort((a,b)=>b.subs-a.subs).slice(0,100);
  const o = {}; arr.forEach(p=>{ o[p.id]=p; delete o[p.id].id; });
  world.leaderboard = o;
}

wss.on("connection", (ws) => {
  ws.playerId = null; ws.isAdmin = false; ws.name = "Игрок";

  ws.send(JSON.stringify({ type: "welcome", world: {
    adminMessage: world.adminMessage, event: world.event,
    bgPreset: world.bgPreset, bgCustom: world.bgCustom,
    leaderboard: world.leaderboard, online: wss.clients.size
  }}));
  broadcast({ type: "online", count: wss.clients.size });

  ws.on("message", (raw) => {
    let d; try { d = JSON.parse(raw); } catch(e){ return; }

    if (d.type === "register") {
      ws.playerId = d.playerId; ws.name = d.name || "Игрок"; ws.isAdmin = !!d.isAdmin;
      if (world.banned[ws.playerId]) {
        ws.send(JSON.stringify({ type:"banned", reason: world.banned[ws.playerId] }));
        ws.close(); return;
      }
      if (d.stats) {
        world.leaderboard[ws.playerId] = {
          name: ws.name, subs: d.stats.subscribers||0, money: d.stats.money||0,
          skin: d.stats.skinName||"Дефолт Бензо", emoji: d.stats.skinEmoji||"🎩",
          photo: d.stats.skinPhoto||null, updatedAt: Date.now()
        };
        cleanLB(); broadcast({ type:"leaderboard", list: world.leaderboard });
      }
      broadcast({ type:"online", count: wss.clients.size });
      return;
    }

    if (d.type === "update" && ws.playerId) {
      world.leaderboard[ws.playerId] = {
        name: ws.name, subs: d.stats.subscribers||0, money: d.stats.money||0,
        skin: d.stats.skinName||"Дефолт Бензо", emoji: d.stats.skinEmoji||"🎩",
        photo: d.stats.skinPhoto||null, updatedAt: Date.now()
      };
      cleanLB(); broadcast({ type:"leaderboard", list: world.leaderboard });
      return;
    }

    if (!ws.isAdmin) return;

    if (d.type === "admin_say") {
      world.adminMessage = d.text; world.adminMessageAt = Date.now();
      broadcast({ type:"admin_say", text: d.text }); return;
    }
    if (d.type === "admin_event") {
      if (d.stop) { world.event = null; broadcast({ type:"event", event:null }); }
      else {
        world.event = { biome:d.biome, name:d.name, mult:d.mult, endsAt: Date.now()+d.minutes*60000 };
        broadcast({ type:"event", event: world.event });
      }
      return;
    }
    if (d.type === "admin_bg") {
      if (d.custom) { world.bgCustom = d.custom; world.bgPreset = "default"; }
      else { world.bgCustom = null; world.bgPreset = d.preset||"default"; }
      broadcast({ type:"bg", preset: world.bgPreset, custom: world.bgCustom }); return;
    }
    if (d.type === "admin_money_all") {
      world.lastAbuse = { text: "💰 Всем выдано $"+d.amount, at: Date.now() };
      broadcast({ type:"give_money", amount:d.amount, from: ws.name }); return;
    }
    if (d.type === "admin_subs_all") {
      world.lastAbuse = { text: "👥 Всем выдано "+d.amount+" подписчиков", at: Date.now() };
      broadcast({ type:"give_subs", amount:d.amount, from: ws.name }); return;
    }
    if (d.type === "admin_ban") {
      world.banned[d.playerId] = d.reason || "Забанен админом";
      wss.clients.forEach(c => {
        if (c.playerId === d.playerId) try {
          c.send(JSON.stringify({ type:"banned", reason: world.banned[d.playerId] }));
          c.close();
        } catch(e){}
      });
      world.lastAbuse = { text: "⛔ Забанен "+d.playerName, at: Date.now() };
      broadcastToAdmins({ type:"banned_confirm", playerName:d.playerName }); return;
    }
    if (d.type === "admin_unban") {
      delete world.banned[d.playerId];
      broadcastToAdmins({ type:"unbanned", playerName:d.playerName }); return;
    }
    if (d.type === "admin_wipe_lb") {
      world.leaderboard = {}; broadcast({ type:"leaderboard", list:{} }); return;
    }
    if (d.type === "admin_kick") {
      wss.clients.forEach(c => {
        if (c.playerId === d.playerId) try {
          c.send(JSON.stringify({ type:"kicked", reason: d.reason||"Кикнут" }));
          c.close();
        } catch(e){}
      });
      return;
    }
  });

  ws.on("close", () => broadcast({ type:"online", count: wss.clients.size }));
});

setInterval(() => {
  if (world.event && world.event.endsAt <= Date.now()) {
    world.event = null; broadcast({ type:"event", event:null });
  }
}, 60000);
setInterval(cleanLB, 30000);

server.listen(PORT, () => console.log("🎥 Бензо Кликер запущен на порту " + PORT));