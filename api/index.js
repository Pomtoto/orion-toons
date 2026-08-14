/* ============================================================
   أوريون · توونز — الخادم الكامل (محرك ManhuaPlus)
   يعمل بالبنية التحتية الاحترافية (كاش، حماية، ضغط)
   متطلبات: npm install express cors cheerio
   ============================================================ */
import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import { promisify } from 'util';
import * as cheerio from 'cheerio';

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

const app = express();
app.disable('x-powered-by');

/* ===== إعدادات عامة ===== */
const BASE_URL = 'https://manhuaplus.com';
const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

/* ===== رؤوس أمان ===== */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
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
  if (req.path.startsWith('/api/image')) return next();

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

/* ===== كاش مع حد أقصى (LRU Cache) ===== */
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

/* ===== محدد معدل الطلبات (Token Bucket) ===== */
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const bucket = buckets.get(ip) || { tokens: 60, last: now };
  const elapsed = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(60, bucket.tokens + elapsed * 10);
  bucket.last = now;

  if (bucket.tokens < 1) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  next();
}
app.use('/api/', rateLimit);

/* ===== سجل بسيط ===== */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

/* ===== أدوات مساعدة لجلب HTML ===== */
async function fetchHTML(url, method = 'GET') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 ثانية حد أقصى
  try {
    const response = await fetch(url, {
      method: method,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Referer': BASE_URL,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ===== نقاط الـ API ===== */

// 1. الصحة
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'Orion Toons - ManhuaPlus Engine',
    version: '3.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 2. قائمة الأعمال (مع دعم الكاش ومنع التكرار)
app.get('/api/works', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const cacheKey = `works:page:${page}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const hostUrl = `${protocol}://${req.get('host')}`;

    const html = await fetchHTML(`${BASE_URL}/manga/page/${page}/`);
    const $ = cheerio.load(html);
    
    const works = [];
    const seen = new Set();
    
    $('.page-item-detail.manga').each((i, el) => {
      const titleElement = $(el).find('.post-title h3 a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href');
      
      const id = url ? url.replace(BASE_URL + '/manga/', '').replace('/', '') : null;
      
      let imgUrl = $(el).find('.item-thumb img').attr('data-src') || $(el).find('.item-thumb img').attr('src');
      if (imgUrl) imgUrl = imgUrl.trim();

      const latestChapter = $(el).find('.chapter-item .chapter a').first().text().trim();

      if (id && !seen.has(id)) {
        seen.add(id);
        works.push({
          id,
          title,
          latest: latestChapter || 'غير متوفر',
          img: `${hostUrl}/api/image?url=${encodeURIComponent(imgUrl)}`
        });
      }
    });

    const result = { page, limit: works.length, works };
    cache.set(cacheKey, result, 1800); // كاش لمدة نصف ساعة
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 3. تفاصيل العمل (مع دعم الكاش والفصول مرتبة تصاعدياً)
app.get('/api/works/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `work:${id}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const hostUrl = `${protocol}://${req.get('host')}`;
    const mangaUrl = `${BASE_URL}/manga/${id}/`;
    
    const html = await fetchHTML(mangaUrl);
    const $ = cheerio.load(html);
    
    const title = $('.post-title h1').text().trim();
    const description = $('.summary__content p').text().trim() || 'لا يوجد وصف متاح';
    let imgUrl = $('.summary_image img').attr('data-src') || $('.summary_image img').attr('src');
    
    const genres = [];
    $('.genres-content a').each((i, el) => {
      genres.push($(el).text().trim());
    });

    const chaptersHtml = await fetchHTML(`${mangaUrl}ajax/chapters/`, 'POST');
    const $ch = cheerio.load(chaptersHtml);
    
    let chapters = [];
    $ch('li.wp-manga-chapter').each((i, el) => {
      const a = $(el).find('a');
      const chapTitle = a.text().trim();
      const chapUrl = a.attr('href');
      const chapId = chapUrl ? chapUrl.replace(mangaUrl, '').replace('/', '') : null;
      
      if (chapId) {
        chapters.push({ id: chapId, title: chapTitle });
      }
    });

    chapters = chapters.reverse(); // من الفصل الأول إلى الأخير

    const result = {
      id,
      title,
      description,
      genres,
      img: imgUrl ? `${hostUrl}/api/image?url=${encodeURIComponent(imgUrl)}` : null,
      totalChapters: chapters.length,
      chapters
    };

    cache.set(cacheKey, result, 3600); // كاش لمدة ساعة
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 4. صفحات الفصل
app.get('/api/chapters/:mangaId/:chapterId/pages', async (req, res) => {
  try {
    const { mangaId, chapterId } = req.params;
    const cacheKey = `pages:${mangaId}:${chapterId}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const hostUrl = `${protocol}://${req.get('host')}`;
    const chapterUrl = `${BASE_URL}/manga/${mangaId}/${chapterId}/`;
    
    const html = await fetchHTML(chapterUrl);
    const $ = cheerio.load(html);
    
    const pages = [];
    $('.reading-content img').each((i, el) => {
      let src = $(el).attr('data-src') || $(el).attr('src');
      if (src) {
        pages.push(`${hostUrl}/api/image?url=${encodeURIComponent(src.trim())}`);
      }
    });

    const result = { total: pages.length, pages };
    cache.set(cacheKey, result, 86400); // كاش لمدة 24 ساعة (الفصول لا تتغير)
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 5. وكيل الصور (Image Proxy) مع دعم الكاش لتخطي الحظر
app.get('/api/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'No URL provided' });

    const cacheKey = `img:${imageUrl}`;
    const cachedBuffer = cache.get(cacheKey);
    
    if (cachedBuffer) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.send(cachedBuffer);
    }

    const response = await fetch(imageUrl, {
      headers: { 
        'User-Agent': UA,
        'Referer': BASE_URL,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    const data = Buffer.from(buffer);

    cache.set(cacheKey, data, 604800); // كاش الصورة لمدة 7 أيام

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(data);
  } catch (e) {
    console.error('Image proxy error:', e.message);
    res.status(404).json({ error: 'Image not found' });
  }
});

/* ===== معالجة أخطاء 404 ===== */
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

/* ===== إغلاق آمن ===== */
const server = app.listen(PORT, () => {
  console.log(`Orion Toons (ManhuaPlus Engine) running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});