const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.post('/api/snapshots', (req, res) => {
  try {
    const body = req.body;
    const required = ['low_mean', 'mid_peak', 'high_variance', 'overall_energy',
                      'dominance', 'emotion_label', 'r', 'g', 'b', 'h', 's', 'l'];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null) {
        return res.status(400).json({ error: `Missing field: ${key}` });
      }
    }
    const info = insertSnapshot.run({
      timestamp: body.timestamp || Date.now(),
      low_mean: body.low_mean,
      mid_peak: body.mid_peak,
      high_variance: body.high_variance,
      overall_energy: body.overall_energy,
      dominance: body.dominance,
      emotion_label: body.emotion_label,
      r: Math.round(body.r),
      g: Math.round(body.g),
      b: Math.round(body.b),
      h: body.h,
      s: body.s,
      l: body.l,
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

app.listen(PORT, () => {
  console.log(`\n🚀 Mood Light Server running at http://localhost:${PORT}`);
  console.log(`💾 Database: ${path.join(DATA_DIR, 'moods.db')}\n`);
});
