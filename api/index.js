import express from 'express';
import cors from 'cors';
import { searchWorks, getWork, getChapters, getPages, ORIGINS } from '../mangadex.js';
import { translateImage, isConfigured } from '../ocr.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Orion Toons', origins: ORIGINS });
});

app.get('/api/works', async (req, res) => {
  try {
    const origin = ['ko','ja','zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';
    const works = await searchWorks({ origin, title, page, limit, stats });
    res.json({ total: works.length, page, works });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/works/:id', async (req, res) => {
  try { res.json(await getWork(req.params.id)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/works/:id/chapters', async (req, res) => {
  try { const c = await getChapters(req.params.id); res.json({ total: c.length, chapters: c }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/chapters/:id/pages', async (req, res) => {
  try { const p = await getPages(req.params.id); res.json({ total: p.length, pages: p }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/ocr', async (req, res) => {
  try {
    const { imageUrl, target = 'ar' } = req.body || {};
    if (!isConfigured()) return res.status(501).json({ error: 'OCR غير مفعّل' });
    res.json({ text: await translateImage(imageUrl, target) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default app;
