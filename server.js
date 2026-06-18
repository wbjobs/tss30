const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const devices = new Map();
const COLOR_BROADCAST_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 5000;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'moods.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS emotion_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    low_mean REAL NOT NULL,
    mid_peak REAL NOT NULL,
    high_variance REAL NOT NULL,
    overall_energy REAL NOT NULL,
    dominance TEXT NOT NULL,
    emotion_label TEXT NOT NULL,
    r INTEGER NOT NULL,
    g INTEGER NOT NULL,
    b INTEGER NOT NULL,
    h REAL NOT NULL,
    s REAL NOT NULL,
    l REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_timestamp ON emotion_snapshots(timestamp);
`);

const insertSnapshot = db.prepare(`
  INSERT INTO emotion_snapshots
  (timestamp, low_mean, mid_peak, high_variance, overall_energy,
   dominance, emotion_label, r, g, b, h, s, l)
  VALUES
  (@timestamp, @low_mean, @mid_peak, @high_variance, @overall_energy,
   @dominance, @emotion_label, @r, @g, @b, @h, @s, @l)
`);

const querySnapshotsByRange = db.prepare(`
  SELECT * FROM emotion_snapshots
  WHERE timestamp >= @start AND timestamp <= @end
  ORDER BY timestamp ASC
`);

const queryLatestSnapshots = db.prepare(`
  SELECT * FROM emotion_snapshots
  ORDER BY timestamp DESC
  LIMIT @limit
`);

const deleteAllSnapshots = db.prepare('DELETE FROM emotion_snapshots');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SILENCE_ENERGY_THRESHOLD = 0.022;

function isValidNumber(v, min = -Infinity, max = Infinity) {
  if (typeof v === 'string') v = Number(v);
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, Number(v)));
}

app.post('/api/snapshots', (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid body: expected object' });
    }
    const required = ['low_mean', 'mid_peak', 'high_variance', 'overall_energy',
                      'dominance', 'emotion_label', 'r', 'g', 'b', 'h', 's', 'l'];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null) {
        return res.status(400).json({ error: `Missing field: ${key}` });
      }
    }

    if (body.emotion_label === '静默' || body.dominance === 'silence') {
      return res.status(202).json({
        success: false,
        skipped: true,
        reason: 'Silence snapshot rejected by filter',
      });
    }

    if (!isValidNumber(body.overall_energy, 0, 1.5)) {
      return res.status(400).json({ error: 'Invalid overall_energy' });
    }
    if (body.overall_energy < SILENCE_ENERGY_THRESHOLD) {
      return res.status(202).json({
        success: false,
        skipped: true,
        reason: 'Silence: overall_energy below threshold',
      });
    }

    const numericZeroOne = ['low_mean', 'mid_peak', 'high_variance', 'overall_energy'];
    for (const k of numericZeroOne) {
      if (!isValidNumber(body[k], -0.01, 1.5)) {
        return res.status(400).json({ error: `Invalid numeric field: ${k}` });
      }
    }

    const rgbFields = ['r', 'g', 'b'];
    for (const k of rgbFields) {
      if (!isValidNumber(body[k], -1, 256)) {
        return res.status(400).json({ error: `Invalid ${k} channel` });
      }
    }
    const r = clamp(body.r, 0, 255);
    const g = clamp(body.g, 0, 255);
    const b = clamp(body.b, 0, 255);
    if (r < 20 && g < 20 && b < 20) {
      return res.status(202).json({
        success: false,
        skipped: true,
        reason: 'Silence: near-black RGB detected',
      });
    }

    if (!isValidNumber(body.h, -1, 361) ||
        !isValidNumber(body.s, -1, 101) ||
        !isValidNumber(body.l, -1, 101)) {
      return res.status(400).json({ error: 'Invalid HSL values' });
    }

    if (typeof body.dominance !== 'string' || body.dominance.length > 16) {
      return res.status(400).json({ error: 'Invalid dominance field' });
    }
    if (typeof body.emotion_label !== 'string' || body.emotion_label.length > 32) {
      return res.status(400).json({ error: 'Invalid emotion_label field' });
    }

    let ts = body.timestamp;
    if (ts !== undefined && ts !== null) {
      if (!isValidNumber(ts, 946656000000, 4102444800000)) {
        return res.status(400).json({ error: 'Invalid timestamp' });
      }
    } else {
      ts = Date.now();
    }

    const info = insertSnapshot.run({
      timestamp: ts,
      low_mean: clamp(body.low_mean, 0, 1),
      mid_peak: clamp(body.mid_peak, 0, 1),
      high_variance: clamp(body.high_variance, 0, 1),
      overall_energy: clamp(body.overall_energy, 0, 1),
      dominance: body.dominance,
      emotion_label: body.emotion_label,
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
      h: clamp(body.h, 0, 360),
      s: clamp(body.s, 0, 100),
      l: clamp(body.l, 0, 100),
    });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('Insert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/snapshots', (req, res) => {
  try {
    const { start, end, limit } = req.query;
    let rows;
    if (start && end) {
      rows = querySnapshotsByRange.all({
        start: parseInt(start, 10),
        end: parseInt(end, 10),
      });
    } else if (limit) {
      rows = queryLatestSnapshots.all({ limit: parseInt(limit, 10) });
    } else {
      rows = queryLatestSnapshots.all({ limit: 1000 });
    }
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/snapshots', (req, res) => {
  try {
    const info = deleteAllSnapshots.run();
    res.json({ success: true, deleted: info.changes });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/devices', (req, res) => {
  const list = [];
  devices.forEach((dev, id) => {
    list.push({
      device_id: id,
      emotion_label: dev.emotion_label || '未知',
      energy: dev.energy || 0,
      r: dev.r || 0,
      g: dev.g || 0,
      b: dev.b || 0,
      h: dev.h || 0,
      s: dev.s || 0,
      l: dev.l || 0,
      is_silent: dev.is_silent || false,
      connected_at: dev.connectedAt,
      last_update: dev.lastUpdate,
    });
  });
  res.json({ count: devices.size, devices: list });
});

function genDeviceId() {
  return 'dev_' + crypto.randomBytes(6).toString('hex');
}

function safeSend(ws, data) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(data)); } catch (e) {}
  }
}

function broadcast(msg, excludeId) {
  const payload = JSON.stringify(msg);
  devices.forEach((dev, id) => {
    if (excludeId && id === excludeId) return;
    if (dev.ws && dev.ws.readyState === 1) {
      try { dev.ws.send(payload); } catch (e) {}
    }
  });
}

function getMergedColorForDevice(localId) {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  let energySum = 0;
  devices.forEach((dev, id) => {
    if (id === localId) return;
    if (dev.is_silent) return;
    if (dev.r === undefined) return;
    rSum += dev.r;
    gSum += dev.g;
    bSum += dev.b;
    energySum += dev.energy || 0;
    count++;
  });
  if (count === 0) return null;
  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
    energy: energySum / count,
    remote_count: count,
  };
}

function getAllSnapshot() {
  const list = [];
  devices.forEach((dev, id) => {
    list.push({
      device_id: id,
      emotion_label: dev.emotion_label || '',
      energy: dev.energy || 0,
      r: dev.r || 0,
      g: dev.g || 0,
      b: dev.b || 0,
      h: dev.h || 0,
      s: dev.s || 0,
      l: dev.l || 0,
      is_silent: dev.is_silent || false,
    });
  });
  return list;
}

wss.on('connection', (ws) => {
  const deviceId = genDeviceId();
  const now = Date.now();
  devices.set(deviceId, {
    ws,
    connectedAt: now,
    lastUpdate: now,
    r: 128, g: 128, b: 128,
    h: 0, s: 0, l: 50,
    energy: 0,
    emotion_label: '连接中',
    is_silent: true,
    isAlive: true,
  });

  safeSend(ws, {
    type: 'welcome',
    device_id: deviceId,
    server_time: now,
    peer_count: devices.size - 1,
    peers: getAllSnapshot().filter(d => d.device_id !== deviceId),
  });

  broadcast({
    type: 'peer_join',
    device_id: deviceId,
    peer_count: devices.size,
    timestamp: Date.now(),
    device: {
      device_id: deviceId,
      emotion_label: '连接中',
      energy: 0,
      r: 128, g: 128, b: 128,
      h: 0, s: 0, l: 50,
      is_silent: true,
    },
  }, deviceId);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const dev = devices.get(deviceId);
      if (!dev) return;

      if (msg.type === 'heartbeat' || msg.type === 'ping') {
        dev.isAlive = true;
        dev.lastUpdate = Date.now();
        if (msg.type === 'ping') safeSend(ws, { type: 'pong', t: Date.now() });
        return;
      }

      if (msg.type === 'color_update') {
        dev.lastUpdate = Date.now();
        dev.r = Math.max(0, Math.min(255, Math.round(msg.r || 0)));
        dev.g = Math.max(0, Math.min(255, Math.round(msg.g || 0)));
        dev.b = Math.max(0, Math.min(255, Math.round(msg.b || 0)));
        dev.h = msg.h || 0;
        dev.s = msg.s || 0;
        dev.l = msg.l || 0;
        dev.energy = msg.energy || 0;
        dev.emotion_label = msg.emotion_label || '';
        dev.is_silent = !!msg.is_silent;
        dev.dominance = msg.dominance || '';
      }
    } catch (e) {
      console.warn('WS message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    devices.delete(deviceId);
    broadcast({
      type: 'peer_leave',
      device_id: deviceId,
      peer_count: devices.size,
      timestamp: Date.now(),
    });
  });

  ws.on('error', (err) => {
    console.warn(`WS error for ${deviceId}:`, err.message);
  });
});

setInterval(() => {
  const list = getAllSnapshot();
  devices.forEach((dev, id) => {
    const merged = getMergedColorForDevice(id);
    safeSend(dev.ws, {
      type: 'state',
      timestamp: Date.now(),
      peer_count: devices.size - 1,
      peers: list.filter(d => d.device_id !== id),
      merged: merged,
    });
  });
}, COLOR_BROADCAST_INTERVAL_MS);

setInterval(() => {
  devices.forEach((dev, id) => {
    if (!dev.isAlive) {
      try { dev.ws.terminate(); } catch (e) {}
      devices.delete(id);
      broadcast({
        type: 'peer_leave',
        device_id: id,
        peer_count: devices.size,
        timestamp: Date.now(),
      });
      return;
    }
    dev.isAlive = false;
    safeSend(dev.ws, { type: 'ping', t: Date.now() });
  });
}, HEARTBEAT_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`\n🚀 Mood Light Server running at http://localhost:${PORT}`);
  console.log(`💾 Database: ${path.join(DATA_DIR, 'moods.db')}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws\n`);
});
