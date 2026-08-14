import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const BASE = 'https://api.mangadex.org';
const UA = 'OrionToons/2.0';

// وسيط MangaDex: يمرر المسار الأصلي كما هو (بدون إعادة ترميز المعاملات)
app.all('/md/*', async (req, res) => {
  try {
    const idx = req.originalUrl.indexOf('/md/');
    const rest = idx >= 0 ? req.originalUrl.slice(idx + 3) : '';
    const url = BASE + rest;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    const text = await r.text();
    let body = text;
    try { body = JSON.parse(text); } catch (_) {}
    res.status(r.status).set('Content-Type', r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Orion Toons' });
});

export default app;
