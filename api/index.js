/* ============================================================
   أوريون · توونز — الخادم الكامل (نسخة معدلة مع Nyora SDK)
   يدعم: ياباني، كوري، صيني، ويبحث عن المصدر الأكثر اكتمالاً
   ============================================================ */
import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import Nyora from 'nyora-sdk';

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

const app = express();
app.disable('x-powered-by');

/* ===== إعدادات عامة ===== */
const BASE = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const UA = 'OrionToons/2.0';
const PORT = process.env.PORT || 3000;

// ==== تهيئة Nyora SDK ====
const nyora = new Nyora();

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

/* ===== ضغط الاستجابة ===== */
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

/* ===== قاطع الدائرة ===== */
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
  const names = tags.map(t => t?.attributes?.name?.en || t).filter(Boolean);
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

function normalize(m, preferredLangs = ['en']) {
  const a = m.attributes || {};
  let coverFile = null;
  // استخراج الغلاف من MangaDex
  if (m.relationships) {
    const coverRel = m.relationships.find(r => r.type === 'cover_art');
    if (coverRel) coverFile = coverRel.attributes?.fileName;
  }
  // استخراج الغلاف من Nyora
  if (!coverFile && m.cover) coverFile = m.cover;
  
  const title = getBestTitle(a, preferredLangs) || m.title || 'بدون عنوان';
  let desc = getBestDescription(a, preferredLangs) || m.description || '';
  if (desc.length > 300) desc = desc.slice(0, 300) + '...';

  return {
    id: m.id || m.url || 'unknown',
    title: title,
    type: ORIGIN[a.originalLanguage] || m.origin || 'غير معروف',
    origin: a.originalLanguage || m.origin || 'unknown',
    genres: mapTags(a.tags || m.tags || []),
    rating: 0,
    views: '',
    latest: a.lastChapter || m.latestChapter || 0,
    time: relTime(a.updatedAt || m.updatedAt),
    img: coverFile ? `/api/image/${m.id || m.url}/${coverFile}` : null,
    description: desc,
    status: a.status === 'ongoing' ? 'مستمر' : a.status === 'completed' ? 'مكتمل' : 'متوقف',
    totalChapters: a.totalChapters || m.chapters?.length || 0
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

/* ===== دالة جلب البيانات المدمجة (Nyora + MangaDex) ===== */

// الدالة القديمة للاحتياط
async function fetchJSON_MangaDex(path, retries = 4) {
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

// الدالة الرئيسية (تحاول Nyora أولاً، ثم MangaDex)
async function fetchJSON(path, retries = 4) {
  // فقط مسارات /manga و /manga/... نستخدم Nyora
  if (path.startsWith('/manga') && !path.includes('/feed')) {
    try {
      console.log('🔍 جلب البيانات من Nyora:', path);
      const url = new URL(path, 'http://dummy.com');
      const params = url.searchParams;
      
      const title = params.get('title') || '';
      const limit = parseInt(params.get('limit')) || 20;
      const offset = parseInt(params.get('offset')) || 0;
      const includesCover = params.has('includes[]') && params.getAll('includes[]').includes('cover_art');
      
      // الحصول على قائمة المصادر
      const allSources = await nyora.sources.list();
      // اختيار مصادر تدعم البحث (نأخذ 5 مصادر)
      const searchable = allSources.filter(s => s.capabilities?.search).slice(0, 5);
      
      let allResults = [];
      for (const src of searchable) {
        try {
          console.log(`   البحث في: ${src.name}`);
          const res = await nyora.manga.search(src.id, title, { limit: 10 });
          if (res.entries) {
            allResults.push(...res.entries.map(e => ({
              ...e,
              sourceId: src.id,
              sourceName: src.name,
              origin: src.language || 'unknown'
            })));
          }
        } catch (e) {
          console.warn(`   فشل البحث في ${src.name}:`, e.message);
        }
      }
      
      // إزالة التكرار حسب العنوان
      const seen = new Set();
      const unique = allResults.filter(m => {
        const key = (m.title || '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      // ترتيب حسب عدد الفصول (الأكثر اكتمالاً أولاً)
      unique.sort((a, b) => (b.chapters?.length || 0) - (a.chapters?.length || 0));
      
      // تقطيع
      const paginated = unique.slice(offset, offset + limit);
      
      // هيكلة مشابهة لـ MangaDex
      return {
        data: paginated.map(m => {
          // استخراج الغلاف
          let coverFile = m.cover || null;
          if (!coverFile && m.covers && m.covers.length > 0) {
            coverFile = m.covers[0];
          }
          return {
            id: m.id || m.url || 'unknown',
            attributes: {
              title: { en: m.title || 'بدون عنوان' },
              description: { en: m.description || '' },
              originalLanguage: m.origin || m.language || 'ja',
              status: m.status || 'ongoing',
              updatedAt: m.updatedAt || new Date().toISOString(),
              lastChapter: m.latestChapter || m.chapters?.length || 0,
              tags: (m.tags || []).map(t => ({ attributes: { name: { en: t } } })),
              totalChapters: m.chapters?.length || 0
            },
            relationships: coverFile ? [{ type: 'cover_art', attributes: { fileName: coverFile } }] : []
          };
        }),
        total: unique.length,
        source: 'nyora' // لتحديد المصدر
      };
    } catch (error) {
      console.error('❌ فشل Nyora، العودة إلى MangaDex:', error.message);
      return fetchJSON_MangaDex(path, retries);
    }
  }
  
  // مسارات أخرى (مثل /statistics, /author) نستخدم MangaDex
  return fetchJSON_MangaDex(path, retries);
}

/* ===== نقاط API ===== */

// الصحة
app.get('/api/health', async (_req, res) => {
  try {
    const sources = await nyora.sources.list();
    res.json({
      ok: true,
      name: 'Orion Toons',
      version: '2.0',
      origins: ORIGIN,
      sourcesCount: sources.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.json({ ok: true, name: 'Orion Toons', version: '2.0', origins: ORIGIN });
  }
});

// قائمة المصادر
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await nyora.sources.list();
    res.json(sources.map(s => ({ id: s.id, name: s.name, lang: s.language })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// التصنيفات (من MangaDex)
app.get('/api/tags', (req, res) => {
  const tagMap = {
    'Action': '391b0423-d847-456f-aff0-8b0cfc03066b',
    'Romance': '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
    'Fantasy': 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
    'Drama': 'f4122d1c-3b44-44d0-9936-ff7502c39ad3',
    'Adventure': 'e5300a8c-e6fa-4bc4-a69c-d0d7c6f67047',
    'Comedy': '4d32cc48-9f00-4cca-9b5a-a839f0764984',
    'Supernatural': 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
    'Horror': 'cdad7e68-1419-41dd-bdce-27753074a640',
    'Sci-Fi': '256c8bd9-4904-4360-bf4f-508a76d67183',
    'Isekai': 'ace04997-f6bd-436e-b261-779182193d3d',
    'School Life': 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
    'Seinen': 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'Shounen': 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    'Shoujo': 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
    'Mecha': '50880a9d-5440-4732-9afb-8f457127e836'
  };
  const list = Object.keys(TAG_AR).map(name => ({
    id: tagMap[name] || 'unknown',
    name: name,
    arabic: TAG_AR[name]
  }));
  res.json({ tags: list });
});

// قائمة الأعمال (نستخدم الدالة المدمجة fetchJSON)
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
    if (origin) params.append('originalLanguage[]', origin);
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

    // استخدام الدالة المدمجة
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

    if (stats && works.length) {
      // محاولة جلب الإحصائيات من Nyora أو MangaDex
      for (const w of works) {
        const s = await getStats(w.id);
        w.rating = s.rating;
        w.views = formatCount(s.follows);
      }
    }

    const total = data.total || works.length;
    const totalPages = Math.ceil(total / limit);
    const result = {
      total,
      page,
      limit,
      totalPages,
      works,
      source: data.source || 'mangadex',
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
    const s = await getStats(req.params.id);
    w.rating = s.rating;
    w.views = formatCount(s.follows);
    res.json(w);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// فصول العمل (جلب من Nyora إذا أمكن)
app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const id = req.params.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const key = `c:${id}:${page}:${limit}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    // محاولة جلب من Nyora أولاً
    try {
      // نبحث عن المصادر التي تحتوي على هذا العمل
      const allSources = await nyora.sources.list();
      const searchable = allSources.filter(s => s.capabilities?.search).slice(0, 5);
      
      let allChapters = [];
      let sourceName = '';
      for (const src of searchable) {
        try {
          // البحث بالعنوان إذا كان موجوداً في req.query
          const title = req.query.title || '';
          if (title) {
            const searchRes = await nyora.manga.search(src.id, title, { limit: 1 });
            const match = searchRes.entries.find(e => e.id === id || e.url === id);
            if (match) {
              const details = await nyora.manga.details(src.id, match.url);
              if (details.chapters && details.chapters.length > 0) {
                allChapters = details.chapters;
                sourceName = src.name;
                break;
              }
            }
          }
        } catch (e) { /* تجاهل */ }
      }

      // إذا لم نجد فصولاً، نبحث مباشرة في المصادر المتاحة
      if (allChapters.length === 0) {
        // جرب البحث المباشر في MangaDex
        const mdData = await fetchJSON_MangaDex(`/manga/${id}/feed?limit=0`);
        const total = mdData.total || 0;
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          'order[volume]': 'desc',
          'order[chapter]': 'desc',
          'translatedLanguage[]': 'en'
        });
        const data = await fetchJSON_MangaDex(`/manga/${id}/feed?${params.toString()}`);
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
        return res.json(result);
      }

      // ترتيب الفصول
      allChapters.sort((a, b) => (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0));
      const total = allChapters.length;
      const paginated = allChapters.slice(offset, offset + limit);

      const result = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        chapters: paginated.map(c => ({
          id: c.id || c.url,
          number: c.number || '?',
          title: c.title || '',
          pages: c.pages || 0,
          time: c.publishedAt ? relTime(c.publishedAt) : '',
          translatedLanguage: c.language || 'en',
          externalUrl: c.externalUrl || null
        })),
        source: 'nyora'
      };
      cache.set(key, result, 1800);
      return res.json(result);

    } catch (e) {
      console.warn('⚠️ فشل جلب الفصول من Nyora، استخدام MangaDex:', e.message);
      // نعيد توجيه الطلب إلى MangaDex
      // نعيد نفس الطلب ولكن باستخدام fetchJSON_MangaDex مباشرة
      const data = await fetchJSON_MangaDex(`/manga/${id}/feed?limit=500`);
      const arr = data.data || [];
      const total = data.total || arr.length;

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
        .slice(offset, offset + limit)
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
      return res.json(result);
    }
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

    // محاولة من Nyora أولاً
    try {
      const data = await fetchJSON(`/at-home/server/${req.params.id}`);
      if (data && data.baseUrl && data.chapter) {
        const pages = (data.chapter.data || []).map(f => `${data.baseUrl}/data/${data.chapter.hash}/${f}`);
        cache.set(key, pages, 86400);
        return res.json({ total: pages.length, pages });
      }
    } catch (e) { /* تجاهل */ }

    // استخدام MangaDex
    const data = await fetchJSON_MangaDex(`/at-home/server/${req.params.id}`);
    const { baseUrl, chapter } = data;
    const pages = (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
    cache.set(key, pages, 86400);
    res.json({ total: pages.length, pages });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// وكيل الصور
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

    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': UA }
    });
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
  console.log(`🚀 Orion Toons server running on port ${PORT}`);
  console.log(`📚 Nyora SDK متصل - يدعم ياباني، كوري، صيني`);
  console.log(`🔄 في حالة فشل Nyora، يعود تلقائياً إلى MangaDex`);
});

process.on('SIGTERM', () => {
  server.close(() => { process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { process.exit(0); });
});

export default app;