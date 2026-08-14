/* ============================================================
   أوريون · توونز — الخادم الكامل في ملف واحد (بدون أي استيرادات خارجية)
   هذا يلغي أي مشكلة تضارب بين النسخ نهائياً.
   ============================================================ */
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

/* ===== كشف صورة إشعار الحذف (DMCA) =====
   MangaDex يستبدل الصفحة الأولى للفصول المحذوفة بصورة إشعار ثابتة
   نكتشفها بالبصمة (MD5) أو الأبعاد الصغيرة ونتجاهلها */
const DMCA_HASHES = ['495feda17883af8b3115ea562318fa29'];
async function isDmca(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (DMCA_HASHES.includes(md5)) return true;
    // فحص أبعاد PNG (البايتات 16-23 = العرض والارتفاع)
    if (buf.length >= 24 && buf.length < 100000) {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      if (w === 768 && h === 1024) return true;
    }
    return false;
  } catch { return false; }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const BASE = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const UA = 'OrionToons/2.0';

/* ===== كاش بسيط ===== */
const cache = new Map();
function cget(key, ttl) {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { cache.delete(key); return undefined; }
  return e.val;
}
function cset(key, val, ttl) { cache.set(key, { val, exp: Date.now() + ttl * 1000 }); }

/* ===== rate limiter ===== */
let lastReq = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function throttle() {
  const wait = lastReq + 250 - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
}
async function fetchJSON(path, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    await throttle();
    const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (res.status === 429) { await sleep(800 * (i + 1)); continue; }
    if (res.status >= 500) { await sleep(600 * (i + 1)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }
  throw new Error('rate limit');
}

const ORIGIN = { ko: 'كوري', ja: 'ياباني', zh: 'صيني' };
const TAG_AR = {
  Action: 'أكشن', Romance: 'رومانسي', Fantasy: 'فانتازيا', Drama: 'دراما',
  Adventure: 'مغامرات', Comedy: 'كوميدي', 'Supernatural': 'خارق', Isekai: 'إيسيكاي',
  'Sci-Fi': 'خيال علمي', Horror: 'رعب', Psychological: 'نفسي', Sports: 'رياضة',
  Thriller: 'إثارة', Mystery: 'غموض', 'Slice of Life': 'شريحة حياة', Historical: 'تاريخي',
  'Martial Arts': 'فنون قتالية', Tragedy: 'تراجيديا', 'School Life': 'حياة مدرسية',
  Seinen: 'سينين', Shounen: 'شونين', Shoujo: 'شوجو', Military: 'عسكري', Mecha: 'ميكا'
};
function mapTags(tags) {
  if (!Array.isArray(tags)) return [];
  const names = tags.map(t => t?.attributes?.name?.en).filter(Boolean);
  return [...new Set(names.map(n => TAG_AR[n] || n))].slice(0, 4);
}
function bestTitle(a) {
  if (a.title?.en) return a.title.en;
  const enAlt = (a.altTitles || []).find(t => t.en);
  if (enAlt) return enAlt.en;
  const k = a.title && Object.keys(a.title)[0];
  if (k) return a.title[k];
  const alt = (a.altTitles || [])[0];
  const k2 = alt && Object.keys(alt)[0];
  return k2 ? alt[k2] : 'بدون عنوان';
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
function normalize(m) {
  const a = m.attributes || {};
  const cover = (m.relationships || []).find(r => r.type === 'cover_art');
  return {
    id: m.id,
    title: bestTitle(a),
    type: ORIGIN[a.originalLanguage] || 'كوري',
    origin: a.originalLanguage,
    genres: mapTags(a.tags),
    rating: 0,
    views: '',
    latest: a.lastChapter || 0,
    time: relTime(a.updatedAt),
    img: cover ? `${UPLOADS}/covers/${m.id}/${cover.attributes.fileName}.512.jpg` : null,
    description: (a.description?.en || '').slice(0, 300),
    status: a.status === 'ongoing' ? 'مستمر' : a.status === 'completed' ? 'مكتمل' : 'متوقف'
  };
}

/* ===== الإحصائيات (تقييم + متابعون) ===== */
async function getStats(id) {
  const key = 's:' + id;
  const hit = cget(key, 43200);
  if (hit) return hit;
  for (let i = 0; i <= 3; i++) {
    const res = await fetch(`${BASE}/statistics/manga/${id}`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (res.status === 429) { await sleep(800 * (i + 1)); continue; }
    if (res.ok) {
      const d = await res.json();
      const s = d.statistics?.[id] || {};
      const out = { rating: s.rating?.average ? Math.round(s.rating.average * 10) / 10 : 0, follows: s.follows || 0 };
      cset(key, out, 43200);
      return out;
    }
    await sleep(400);
  }
  return { rating: 0, follows: 0 };
}
async function enrichStats(works) {
  const BATCH = 5;
  for (let i = 0; i < works.length; i += BATCH) {
    const chunk = works.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(w => getStats(w.id)));
    chunk.forEach((w, j) => { w.rating = results[j].rating; w.views = formatCount(results[j].follows); });
    if (i + BATCH < works.length) await sleep(1100);
  }
  return works;
}

/* ===== نقاط الـ API ===== */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'Orion Toons', origins: ORIGIN });
});

/* ===== وسيط MangaDex (Proxy) =====
   يمرر أي طلب تحت /md/... إلى MangaDex ويعيد الاستجابة بصيغتها الأصلية
   هذا يحل مشكلة CORS لأن الطلب يصبح من الخادم (نفس المنشأ) */
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

app.get('/api/works', async (req, res) => {
  try {
    const origin = ['ko', 'ja', 'zh'].includes(req.query.origin) ? req.query.origin : null;
    const title = (req.query.title || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const stats = req.query.stats !== '0' && req.query.stats !== 'false';

    const key = `w:${origin || 'all'}:${title}:${page}:${limit}:${stats ? 1 : 0}`;
    const cached = cget(key, 3600);
    if (cached) return res.json(cached);

    const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit), 'contentRating[]': 'safe' });
    params.append('contentRating[]', 'suggestive');
    if (origin && ORIGIN[origin]) params.append('originalLanguage[]', origin);
    if (title) params.set('title', title);
    params.append('order[followedCount]', 'desc');
    params.append('includes[]', 'cover_art');
    params.append('hasAvailableChapters', 'true');

    const data = await fetchJSON(`/manga?${params.toString()}`);
    // إزالة التكرار
    const seen = new Set();
    let works = [];
    for (const m of (data.data || [])) {
      const w = normalize(m);
      const k = w.id, kt = w.title.trim().toLowerCase();
      if (seen.has(k) || seen.has('t:' + kt)) continue;
      seen.add(k); seen.add('t:' + kt);
      works.push(w);
    }
    if (stats && works.length) await enrichStats(works);
    const result = { total: data.total || works.length, page, works };
    cset(key, result, 3600);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/works/:id', async (req, res) => {
  try {
    const data = await fetchJSON(`/manga/${req.params.id}?includes[]=cover_art`);
    const w = normalize(data.data);
    const s = await getStats(req.params.id);
    w.rating = s.rating; w.views = formatCount(s.follows);
    res.json(w);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/works/:id/chapters', async (req, res) => {
  try {
    const key = 'c:' + req.params.id;
    const cached = cget(key, 1800);
    if (cached) return res.json({ total: cached.length, chapters: cached });

    let all = [], offset = 0, total = 0;
    do {
      const params = new URLSearchParams({ limit: '500', offset: String(offset), 'order[volume]': 'desc', 'order[chapter]': 'desc' });
      const data = await fetchJSON(`/manga/${req.params.id}/feed?${params.toString()}`);
      const arr = data.data || [];
      total = data.total || 0;
      all = all.concat(arr);
      offset += arr.length;
      if (!arr.length) break;
    } while (offset < total && all.length < 3000);

    const LANG_PRIORITY = ['en', 'ar', 'fr', 'es', 'pt-br', 'it', 'de', 'tr', 'id', 'vi', 'pl', 'ru'];
    const byNum = new Map();
    for (const c of all) {
      const a = c.attributes || {};
      const num = a.chapter || a.title || '?';
      const ex = byNum.get(num);
      if (!ex) { byNum.set(num, c); continue; }
      const rank = l => { const i = LANG_PRIORITY.indexOf(l); return i === -1 ? 999 : i; };
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
        translatedLanguage: c.attributes?.translatedLanguage
      }));
    cset(key, chapters, 1800);
    res.json({ total: chapters.length, chapters });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/chapters/:id/pages', async (req, res) => {
  try {
    const key = 'p:' + req.params.id;
    const cached = cget(key, 86400);
    if (cached) return res.json(cached);
    const data = await fetchJSON(`/at-home/server/${req.params.id}`);
    const { baseUrl, chapter } = data;
    let pages = (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
    // إشعار الحذف (DMCA) يظهر في الصفحة الأولى فقط — نفحص أول 3 صفحات ونحذف أي إشعار
    for (let i = 0; i < Math.min(3, pages.length); i++) {
      if (await isDmca(pages[i])) {
        pages.splice(i, 1);
        i--; // بعد الحذف نعيد فحص نفس الموضع
      }
    }
    const result = { total: pages.length, pages };
    cset(key, result, 86400);
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

export default app;
