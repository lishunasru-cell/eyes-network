import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const http = createServer(app);
const io = new Server(http);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/stream', (_, res) => res.sendFile(path.join(__dirname, 'public', 'stream.html')));
app.get('/qr', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/stream`;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ГЛАЗА — QR</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#03050c;color:#e2e8f0;font-family:'SF Mono',monospace;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}.logo{font-size:13px;letter-spacing:.2em;color:#3b82f6}img{border:1px solid rgba(59,130,246,.2);border-radius:8px;background:#fff;padding:12px}p{font-size:12px;color:#64748b;letter-spacing:.06em}a{color:#3b82f6;text-decoration:none}</style></head><body><div class="logo">● ГЛАЗА</div><img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}" width="280" height="280"><p>Сканируй → откроется стрим</p><a href="/stream">${url}</a></body></html>`);
});
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// pool: Map<socketId, { context, joinedAt }>
const pool = new Map();
// rooms: Map<roomId, [id1, id2]>
const rooms = new Map();

function scoreMatch(a, b) {
  const wa = a.toLowerCase().split(/[\s,·]+/).filter(w => w.length > 2);
  const wb = b.toLowerCase().split(/[\s,·]+/).filter(w => w.length > 2);
  let score = 0;
  for (const w of wa) {
    if (wb.some(x => x.includes(w) || w.includes(x))) score++;
  }
  return score;
}

function commonTags(a, b) {
  const wa = a.toLowerCase().split(/[\s,·]+/).filter(w => w.length > 2);
  const wb = b.toLowerCase().split(/[\s,·]+/).filter(w => w.length > 2);
  return wa.filter(w => wb.some(x => x.includes(w) || w.includes(x)));
}

io.on('connection', socket => {
  console.log('+', socket.id);

  socket.on('join-pool', ({ context }) => {
    let best = null;
    let bestScore = -1;

    for (const [id, peer] of pool) {
      const s = scoreMatch(context, peer.context);
      if (best === null || s > bestScore) {
        bestScore = s;
        best = { id, peer };
      }
    }

    if (best) {
      pool.delete(best.id);

      const roomId = [socket.id, best.id].sort().join(':');
      rooms.set(roomId, [socket.id, best.id]);
      socket.join(roomId);
      io.sockets.sockets.get(best.id)?.join(roomId);

      const common = commonTags(context, best.peer.context);
      const pct = common.length > 0
        ? Math.min(97, 65 + common.length * 8)
        : 52 + Math.floor(Math.random() * 22);

      io.to(socket.id).emit('matched', {
        roomId, role: 'caller',
        peerContext: best.peer.context, matchPct: pct, commonTags: common,
      });
      io.to(best.id).emit('matched', {
        roomId, role: 'callee',
        peerContext: context, matchPct: pct, commonTags: common,
      });
      console.log(`room ${roomId} · ${pct}%`);
    } else {
      pool.set(socket.id, { context, joinedAt: Date.now() });
      socket.emit('waiting');
    }
  });

  socket.on('signal', ({ roomId, data }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const peerId = room.find(id => id !== socket.id);
    if (peerId) io.to(peerId).emit('signal', { data });
  });

  const cleanup = () => {
    pool.delete(socket.id);
    for (const [roomId, users] of rooms) {
      if (users.includes(socket.id)) {
        const peerId = users.find(id => id !== socket.id);
        if (peerId) io.to(peerId).emit('peer-left');
        rooms.delete(roomId);
        console.log(`room ${roomId} closed`);
        break;
      }
    }
    console.log('-', socket.id);
  };

  socket.on('leave', cleanup);
  socket.on('disconnect', cleanup);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`eyes-network :${PORT}`));
