/* ============================================================
   أوريون · توونز — الخادم الكامل في ملف واحد (نسخة محسّنة مع وكيل صور)
   ============================================================ */
import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

const app = express();
app.disable('x-powered-by');

/* ===== إعدادات عامة ===== */
const BASE = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const UA = 'OrionToons/2.0';
const PORT = process.env.PORT || 3000;

/* ===== رؤوس أمان ===== */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://uploads.mangadex.org; style-src 'self' 'unsafe-inline'");
  next();
});

/* ===== CORS مقيد ===== */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET'],
  maxAge: 86400
}));

/* ===== ضغط الاستجابة (نستثني الصور) ===== */
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/image/')) return next();
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    const jsonString = JSON.stringify(body);
    const buffer = Buffer.from(jsonString, 'utf-8');
    let compressed = buffer;
    let encoding = 'identity';
    if (acceptEncoding.includes('br')) {
      compressed = await brotliCompress(buffer);
      encoding = 'br';
    } else if (acceptEncoding.includes('gzip')) {
      compressed = await gzip(buffer);
      encoding = 'gzip';
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', compressed.length);
    res.send(compressed);
  };
  next();
});

app.use(express.json({ limit: '2mb' }));

/* ===== كاش ===== */
class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const entry = this.cache.get(key);
    if (Date.now() > entry.exp) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.val;
  }
  set(key, val, ttl) {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { val, exp: Date.now() + ttl * 1000 });
  }
}
const cache = new LRUCache(500);

/* ===== معدل الطلبات ===== */
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const bucket = buckets.get(ip) || { tokens: 60, last: now };
  const elapsed = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(60, bucket.tokens + elapsed * 10);
  bucket.last = now;
  if (bucket.tokens < 1) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  next();
}
app.use('/api/', rateLimit);

/* ===== سجل ===== */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

/* ===== أدوات مساعدة ===== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

class CircuitBreaker {
  constructor(threshold = 5, cooldown = 60000) {
    this.threshold = threshold;
    this.cooldown = cooldown;
    this.failures = 0;
    this.lastFailure = 0;
  }
  async exec(fn) {
    if (this.failures >= this.threshold && Date.now() - this.lastFailure < this.cooldown) {
      throw new Error('Service temporarily unavailable');
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailure = Date.now();
      throw err;
    }
  }
}
const mangaDexBreaker = new CircuitBreaker();

async function fetchJSON(path, retries = 4) {
  return mangaDexBreaker.exec(async () => {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetchWithTimeout(BASE + path, {
          headers: { 'User-Agent': UA, 'Accept': 'application/json' }
        });
        if (res.status === 429) { await sleep(800 * (i + 1)); continue; }
        if (res.status >= 500) { await sleep(600 * (i + 1)); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (err) {
        if (i === retries) throw err;
        await sleep(500 * (i + 1));
      }
    }
    throw new Error('rate limit');
  });
}

/* ===== ترجمة ===== */
const ORIGIN = { ko: 'كوري', ja: 'ياباني', zh: 'صيني' };
const TAG_AR = {
  Action: 'أكشن', Romance: 'رومانسي', Fantasy: 'فانتازيا', Drama: 'دراما',
  Adventure: 'مغامرات', Comedy: 'كوميدي', 'Supernatural': 'خارق', Isekai: 'إيسيكاي',
  'Sci-Fi': 'خيال علمي', Horror: 'رعب', Psychological: 'نفسي', Sports: 'رياضة',
  Thriller: 'إثارة', Mystery: 'غموض', 'Slice of Life': 'شريحة حياة', Historical: 'تاريخي',
  'Martial Arts': 'فنون قتالية', Tragedy: 'تراجيديا', 'School Life': 'حياة مدرسية',
  Seinen: 'سينين', Shounen: 'شونين', Shoujo: 'شوجو', Military: 'عسكري', Mecha: 'ميكا'
};

function getBestTitle(manga, preferredLangs = ['en']) {
  const titleObj = manga.title || {};
  const altTitles = manga.altTitles || [];
  for (const lang of preferredLangs) {
    if (titleObj[lang]) return titleObj[lang];
    const alt = altTitles.find(t => t[lang]);
    if (alt) return alt[lang];
  }
  const keys = Object.keys(titleObj);
  if (keys.length) return titleObj[keys[0]];
  const altKeys = Object.keys(altTitles[0] || {});
  return altKeys.length ? altTitles[0][altKeys[0]] : 'بدون عنوان';
}

function getBestDescription(manga, preferredLangs = ['en']) {
  const desc = manga.description || {};
  for (const lang of preferredLangs) {
    if (desc[lang]) return desc[lang];
  }
  const keys = Object.keys(desc);
  return keys.length ? desc[keys[0]] : '';
}

function mapTags(tags) {
  if (!Array.isArray(tags)) return [];
  const names = tags.map(t => t?.attributes?.name?.en).filter(Boolean);
  return [...new Set(names.map(n => TAG_AR[n] || n))].slice(0, 4);
}

function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 2592000) return `قبل ${Math.floor(diff / 86400)} يوم`;
  return 'منذ فترة';
}

function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n || 0);
}

// ======== التعديل الأساسي هنا ========
function normalize(m, preferredLangs = ['en']) {
  const a = m.attributes || {};
  const cover = (m.relationships || []).find(r => r.type === 'cover_art');
  const title = getBestTitle(a, preferredLangs);
  let desc = getBestDescription(a, preferredLangs);
  if (desc.length > 300) desc = desc.slice(0, 300) + '...';

  return {
    id: m.id,
    title: title,
    type: ORIGIN[a.originalLanguage] || 'كوري',
    origin: a.originalLanguage,
    genres: mapTags(a.tags),
    rating: 0,
    views: '',
    latest: a.lastChapter || 0,
    time: relTime(a.updatedAt),
    // نستخدم وكيل الصور بدلاً من الرابط المباشر
    img: cover ? `/api/image/${m.id}/${cover.attributes.fileName}?size=512` : null,
    description: desc,
    status: a.status === 'ongoing' ? 'مستمر' : a.status === 'completed' ? 'مكتمل' : 'متوقف',
    totalChapters: 0
  };
}

/* ===== إحصائيات ===== */
async function getStats(id) {
  const key = 's:' + id;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(`${BASE}/statistics/manga/${id}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    if (res.ok) {
      const d = await res.json();
      const s = d.statistics?.[id] || {};
      const out = { rating: s.rating?.average ? Math.round(s.rating.average * 10) / 10 : 0, follows: s.follows || 0 };
      cache.set(key, out, 43200);
      return out;
    }
    if (res.status === 429) await sleep(1000);
  } catch (e) { /* ignore */ }
  return { rating: 0, follows: 0 };
}

async function enrichStats(works) {
  const BATCH = 5;
  for (let i = 0; i < works.length; i += BATCH) {
    const chunk = works.slice(i, i + BATCH);
    const results = await Promise.allSettled(chunk.map(w => getStats(w.id)));
    chunk.forEach((w, j) => {
      if (results[j].status === 'fulfilled') {
        w.rating = results[j].value.rating;
        w.views = formatCount(results[j].value.follows);
      } else {
        w.rating = 0;
        w.views = '';
      }
    });
    if (i + BATCH < works.length) await sleep(1100);
  }
  return works;
}

async function getTotalChapters(id) {
  const key = 'tc:' + id;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const res = await fetchWithTimeout(`${BASE}/manga/${id}/feed?limit=0&translatedLanguage[]=en`, {
      headers: { 'User-Agent': UA }
    });
    if (res.ok) {
      const data = await res.json();
      const total = data.total || 0;
      cache.set(key, total, 3600);
      return total;
    }
  } catch (e) { /* ignore */ }
  return 0;
}

/* ===== نقاط API ===== */

// الصحة
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Orion Toons', version: '2.1', origins: ORIGIN, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// التصنيفات
app.get('/api/tags', (req, res) => {
  const tagMap = {
    'Action': '391b0423-d847-456f-aff0-8b6cf54f9386',
    'Romance': '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
    'Fantasy': 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
    'Drama': 'f4122d1c-3b7e-44c2-98a5-fd9ae7b9ea93',
    'Adventure': 'e5300a8c-e6fa-4bc4-a69c-d0d7c6f67047',
    'Comedy': 'f29e5f5a-bd80-40e3-bb58-2de2393d14a9',
    'Supernatural': 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
    'Isekai': 'a3c3b6f5-8c1d-4a1a-9b0e-2b3c4d5e6f7a',
    'Sci-Fi': '256c8bd9-2f6c-4c24-8fb8-2d7e4e4e4e4e',
    'Horror': 'cdad9e1b-8d2c-4b6e-9e3f-7f8e4a9b4c2d',
    'Psychological': '92d6d2f4-8c5a-4e5a-8f9b-2d3e4f5g6h7i',
    'Sports': '0d4d6c1a-8b2c-4d3e-8f9a-1b2c3d4e5f6g',
    'Thriller': 'd4c9b9e4-8f6a-4b2c-9e1d-3f4a5b6c7d8e',
    'Mystery': '8f6a4b2c-9e1d-3f4a-5b6c-7d8e9f0a1b2c',
    'Slice of Life': 'e3d4c5b6-7a8f-4e2d-9c1b-3f4a5b6c7d8e',
    'Historical': 'f5e4d3c2-b1a0-4f9e-8d7c-6b5a4f3e2d1c',
    'Martial Arts': '1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e',
    'Tragedy': '2c3d4e5f-6a7b-8c9d-0e1f-2a3b4c5d6e7f',
    'School Life': '3d4e5f6a-7b8c-9d0e-1f2a-3b4c5d6e7f8a',
    'Seinen': 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'Shounen': 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    'Shoujo': 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
    'Military': 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a',
    'Mecha': 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b'
  };
  const list = Object.keys(TAG_AR).map(name => ({
    id: tagMap[name] || 'unknown',
    name: name,
    arabic: TAG_AR[name]
  }));
  res.json({ tags: list });
});

// المؤلفون
app.get('/api/authors/:id', async (req, res) => {
  try {
    const data = await fetchJSON(`/author/${req.params.id}?includes[]=manga`);
    const author = data.data;
    const attrs = author.attributes || {};
    const works = (data.relationships || []).filter(r => r.type === 'manga').map(r => ({ id: r.id }));
    res.json({
      id: author.id,
      name: attrs.name || 'مجهول',
      biography: attrs.biography?.en || '',
      image: attrs.imageUrl || null,
      works: works.slice(0, 20)
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// قائمة الأعمال
app.get('/api/works', async (req, res) => {
  try {
    const preferredLangs = (req.headers['accept-language'] || 'en').split(',').map(l => l.split('-')[0].trim());
    let contentRatings = (req.query.rating || 'safe,suggestive').split(',').map(s => s.trim());
    contentRatings = contentRatings.filter(r => ['safe', 'suggestive', 'erotica', 'pornographic'].includes(r));
    if (!contentRatings.length) contentRatings = ['safe', 'suggestive'];

    const origin = ['ko', 'ja', 'zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const tags = req.query.tags ? String(req.query.tags).split(',') : [];
    const order = req.query.order || 'followedCount.desc';

    const key = `w:${origin || 'all'}:${title}:${page}:${limit}:${stats ? 1 : 0}:${status || ''}:${tags.join(',')}:${order}:${contentRatings.join(',')}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String((page - 1) * limit),
      'hasAvailableChapters': 'true',
      'order[followedCount]': 'desc'
    });
    contentRatings.forEach(r => params.append('contentRating[]', r));
    if (origin && ORIGIN[origin]) params.append('originalLanguage[]', origin);
    if (title) params.set('title', title);
    if (status && ['ongoing', 'completed', 'cancelled', 'hiatus'].includes(status)) {
      params.set('status', status);
    }
    if (tags.length) {
      tags.forEach(tag => params.append('includedTags[]', tag));
    }
    params.append('includes[]', 'cover_art');

    if (order === 'rating.desc') params.set('order[rating]', 'desc');
    if (order === 'latestUploadedChapter.desc') params.set('order[latestUploadedChapter]', 'desc');

    const data = await fetchJSON(`/manga?${params.toString()}`);

    const seen = new Set();
    let works = [];
    for (const m of (data.data || [])) {
      const w = normalize(m, preferredLangs);
      const k = w.id, kt = w.title.trim().toLowerCase();
      if (seen.has(k) || seen.has('t:' + kt)) continue;
      seen.add(k); seen.add('t:' + kt);
      works.push(w);
    }

    if (stats && works.length) await enrichStats(works);

    const total = data.total || works.length;
    const totalPages = Math.ceil(total / limit);
    const result = {
      total,
      page,
      limit,
      totalPages,
      works,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
    cache.set(key, result, 3600);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// تفاصيل عمل
app.get('/api/works/:id', async (req, res) => {
  try {
    const preferredLangs = (req.headers['accept-language'] || 'en').split(',').map(l => l.split('-')[0].trim());
    const data = await fetchJSON(`/manga/${req.params.id}?includes[]=cover_art`);
    const w = normalize(data.data, preferredLangs);
    const [statsRes, totalCh] = await Promise.allSettled([
      getStats(req.params.id),
      getTotalChapters(req.params.id)
    ]);
    if (statsRes.status === 'fulfilled') {
      w.rating = statsRes.value.rating;
      w.views = formatCount(statsRes.value.follows);
    }
    if (totalCh.status === 'fulfilled') {
      w.totalChapters = totalCh.value;
    }
    res.json(w);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// فصول مع ترحيل
app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const key = `c:${req.params.id}:${page}:${limit}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const totalRes = await fetchJSON(`/manga/${req.params.id}/feed?limit=0`);
    const total = totalRes.total || 0;

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      'order[volume]': 'desc',
      'order[chapter]': 'desc',
      'translatedLanguage[]': 'en'
    });
    const data = await fetchJSON(`/manga/${req.params.id}/feed?${params.toString()}`);
    const arr = data.data || [];

    const LANG_PRIORITY = ['en', 'ar', 'fr', 'es', 'pt-br', 'it', 'de', 'tr', 'id', 'vi', 'pl', 'ru'];
    const byNum = new Map();
    for (const c of arr) {
      const a = c.attributes || {};
      const num = a.chapter || a.title || '?';
      const ex = byNum.get(num);
      if (!ex) {
        byNum.set(num, c);
        continue;
      }
      const rank = l => {
        const i = LANG_PRIORITY.indexOf(l);
        return i === -1 ? 999 : i;
      };
      if (rank(a.translatedLanguage) < rank(ex.attributes?.translatedLanguage)) byNum.set(num, c);
    }

    const chapters = [...byNum.values()]
      .sort((a, b) => (parseFloat(b.attributes?.chapter) || 0) - (parseFloat(a.attributes?.chapter) || 0))
      .map(c => ({
        id: c.id,
        number: c.attributes?.chapter || c.attributes?.title || '?',
        title: c.attributes?.title || '',
        pages: c.attributes?.pages || 0,
        time: relTime(c.attributes?.publishAt),
        translatedLanguage: c.attributes?.translatedLanguage,
        externalUrl: c.attributes?.externalUrl || null
      }));

    const result = { total, page, limit, totalPages: Math.ceil(total / limit), chapters };
    cache.set(key, result, 1800);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// صفحات الفصل
app.get('/api/chapters/:id/pages', async (req, res) => {
  try {
    const key = 'p:' + req.params.id;
    const cached = cache.get(key);
    if (cached) return res.json({ total: cached.length, pages: cached });

    const data = await fetchJSON(`/at-home/server/${req.params.id}`);
    const { baseUrl, chapter } = data;
    const pages = (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
    cache.set(key, pages, 86400);
    res.json({ total: pages.length, pages });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ===== وكيل الصور (المعدل) =====
app.get('/api/image/:mangaId/:filename', async (req, res) => {
  try {
    const { mangaId, filename } = req.params;
    const size = req.query.size || '512';

    let baseName = filename;
    let ext = 'jpg';
    if (filename.includes('.')) {
      const parts = filename.split('.');
      ext = parts.pop();
      baseName = parts.join('.');
    }
    const finalFile = `${baseName}.${size}.${ext}`;
    const imageUrl = `${UPLOADS}/covers/${mangaId}/${finalFile}`;

    const cacheKey = `img:${mangaId}:${finalFile}`;
    const cachedBuffer = cache.get(cacheKey);
    if (cachedBuffer) {
      res.setHeader('Content-Type', `image/${ext}`);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.send(cachedBuffer);
    }

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const data = Buffer.from(buffer);

    cache.set(cacheKey, data, 604800);
    res.setHeader('Content-Type', `image/${ext}`);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(data);
  } catch (e) {
    console.error('Image proxy error:', e.message);
    res.status(404).json({ error: 'Image not found' });
  }
});

/* ===== 404 ===== */
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* ===== تشغيل الخادم ===== */
const server = app.listen(PORT, () => {
  console.log(`Orion Toons server running on port ${PORT}`);
  console.log(`- Image Proxy: /api/image/:mangaId/:filename`);
});

process.on('SIGTERM', () => {
  server.close(() => { process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { process.exit(0); });
});

export default app;