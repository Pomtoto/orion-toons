import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const BASE = 'https://api.mangadex.org';
const UA = 'OrionToons/2.0';

// وسيط MangaDex: يمرر أي طلب /md/... إلى MangaDex ويعيد النتيجة
app.all('/md/*', async (req, res) => {
  try {
    const sub = req.params[0] || '';
    const qs = new URLSearchParams();
    for (const k of Object.keys(req.query)) {
      const vals = [].concat(req.query[k]);
      vals.forEach(v => qs.append(k, v));
    }
    const qstr = qs.toString();
    const url = `${BASE}/${sub}${qstr ? '?' + qstr : ''}`;
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
