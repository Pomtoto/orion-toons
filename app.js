import express from 'express';
import cors from 'cors';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { searchWorks, getWork, getChapters, getPages, ORIGINS } from './mangadex.js';
import { translateImage, isConfigured } from './ocr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readStatic(name) {
  const paths = [path.join(__dirname, name), path.join(process.cwd(), name)];
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  console.error('ملف ثابت غير موجود: ' + name);
  return '';
}

const INDEX = readStatic('index.html');
const MANIFEST = readStatic('manifest.webmanifest');
const SW = readStatic('sw.js');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/robots.txt', (req, res) => {
  const base = process.env.SITE_URL || `https://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml`);
});

app.get('/sitemap.xml', async (req, res) => {
  const base = process.env.SITE_URL || `https://${req.get('host')}`;
  let works = [];
  try { works = await searchWorks({ limit: 500, stats: false }); } catch (_) {}
  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
    .concat(works.map(w => `<url><loc>${base}/?work=${encodeURIComponent(w.id)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`))
    .join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

app.get('/', (_req, res) => res.type('html').send(INDEX));
app.get('/manifest.webmanifest', (_req, res) => res.type('application/manifest+json').send(MANIFEST));
app.get('/sw.js', (_req, res) => res.type('application/javascript').send(SW));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'Orion Toons Backend',
    origins: ORIGINS,
    ocr: isConfigured() ? 'enabled' : 'disabled (بدون مفتاح)',
    chapterLang: process.env.CHAPTER_LANG || 'en'
  });
});

app.get('/api/works', async (req, res) => {
  try {
    const origin = ['ko', 'ja', 'zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';
    const works = await searchWorks({ origin, title, page, limit, stats });
    res.json({ total: works.length, page, works });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/works/:id', async (req, res) => {
  try {
    const work = await getWork(req.params.id);
    res.json(work);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const chapters = await getChapters(req.params.id);
    res.json({ total: chapters.length, chapters });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/chapters/:id/pages', async (req, res) => {
  try {
    const pages = await getPages(req.params.id);
    res.json({ total: pages.length, pages });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/ocr', async (req, res) => {
  try {
    const { imageUrl, target = 'ar' } = req.body || {};
    if (!isConfigured()) {
      return res.status(501).json({ error: 'OCR غير مفعّل — اضبط مفتاح API في .env' });
    }
    const text = await translateImage(imageUrl, target);
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

export default app;  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`]
    .concat(works.map(w => `<url><loc>${base}/?work=${encodeURIComponent(w.id)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`))
    .join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

/* ============ الواجهة الأمامية ============ */
app.get('/', (_req, res) => res.type('html').send(INDEX));
app.get('/manifest.webmanifest', (_req, res) => res.type('application/manifest+json').send(MANIFEST));
app.get('/sw.js', (_req, res) => res.type('application/javascript').send(SW));

/* ============ الفحص الصحي ============ */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'Orion Toons Backend',
    origins: ORIGINS,
    ocr: isConfigured() ? 'enabled' : 'disabled (بدون مفتاح)',
    chapterLang: process.env.CHAPTER_LANG || 'en'
  });
});

/* ============ قائمة الأعمال ============
   GET /api/works?origin=ko|ja|zh|all&title=&page=1&limit=30 */
app.get('/api/works', async (req, res) => {
  try {
    const origin = ['ko', 'ja', 'zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';
    const works = await searchWorks({ origin, title, page, limit, stats });
    res.json({ total: works.length, page, works });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ تفاصيل عمل ============ */
app.get('/api/works/:id', async (req, res) => {
  try {
    const work = await getWork(req.params.id);
    res.json(work);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ فصول عمل ============ */
app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const chapters = await getChapters(req.params.id);
    res.json({ total: chapters.length, chapters });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ صفحات فصل ============ */
app.get('/api/chapters/:id/pages', async (req, res) => {
  try {
    const pages = await getPages(req.params.id);
    res.json({ total: pages.length, pages });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ ترجمة OCR ============
   POST /api/ocr  { imageUrl, target } → { text } */
app.post('/api/ocr', async (req, res) => {
  try {
    const { imageUrl, target = 'ar' } = req.body || {};
    if (!isConfigured()) {
      return res.status(501).json({ error: 'OCR غير مفعّل — اضبط مفتاح API في .env' });
    }
    const text = await translateImage(imageUrl, target);
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ معالجة الأخطاء ============ */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

export default app;    .join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

/* تقديم الواجهة الأمامية (نفس المنشأ → بلا CORS) */
app.use(express.static(path.join(__dirname, 'public')));

/* ============ الفحص الصحي ============ */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'Orion Toons Backend',
    origins: ORIGINS,
    ocr: isConfigured() ? 'enabled' : 'disabled (بدون مفتاح)',
    chapterLang: process.env.CHAPTER_LANG || 'en'
  });
});

/* ============ قائمة الأعمال ============
   GET /api/works?origin=ko|ja|zh|all&title=&page=1&limit=30
   يعيد مصفوفة أعمال ببنية الواجهة الأمامية */
app.get('/api/works', async (req, res) => {
  try {
    const origin = ['ko', 'ja', 'zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';
    const works = await searchWorks({ origin, title, page, limit, stats });
    res.json({ total: works.length, page, works });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ تفاصيل عمل ============ */
app.get('/api/works/:id', async (req, res) => {
  try {
    const work = await getWork(req.params.id);
    res.json(work);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ فصول عمل ============ */
app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const chapters = await getChapters(req.params.id);
    res.json({ total: chapters.length, chapters });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ صفحات فصل ============ */
app.get('/api/chapters/:id/pages', async (req, res) => {
  try {
    const pages = await getPages(req.params.id);
    res.json({ total: pages.length, pages });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ ترجمة OCR ============
   POST /api/ocr  { imageUrl, target }
   تعيد { text } أو خطأ واضح */
app.post('/api/ocr', async (req, res) => {
  try {
    const { imageUrl, target = 'ar' } = req.body || {};
    if (!isConfigured()) {
      return res.status(501).json({ error: 'OCR غير مفعّل — اضبط مفتاح API في .env' });
    }
    const text = await translateImage(imageUrl, target);
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ============ معالجة الأخطاء ============ */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

export default app;
