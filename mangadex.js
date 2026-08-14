/* عميل MangaDex — مع إدارة rate-limiting وإعادة المحاولة والكاش
   يعتمد originalLanguage للتمييز:
   ko = مانهوا كورية ، ja = مانغا يابانية ، zh = مانها صينية */
import { Cache } from './cache.js';

const BASE = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const UA = 'OrionToons/2.0 (https://orion.toons; contact@orion.toons)';

const worksCache = new Cache(parseInt(process.env.CACHE_TTL_WORKS || 3600));
const chaptersCache = new Cache(parseInt(process.env.CACHE_TTL_CHAPTERS || 1800));
const pagesCache = new Cache(parseInt(process.env.CACHE_TTL_PAGES || 86400));
const statsCache = new Cache(43200); // الإحصائيات بطيئة التغيّر: 12 ساعة

/* ---- rate limiter: طلب واحد كل 250ms (4 طلبات/ثانية، آمن) ---- */
let lastReq = 0;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function throttle() {
  const wait = lastReq + 250 - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
}

/* ---- جلب مع إعادة محاولة على 429/5xx ---- */
async function fetchJSON(path, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    await throttle();
    const res = await fetch(BASE + path, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    if (res.status === 429) { await sleep(800 * (i + 1)); continue; }
    if (res.status >= 500) { await sleep(600 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`MangaDex HTTP ${res.status}`);
    return await res.json();
  }
  throw new Error('MangaDex: استنفدت محاولات إعادة المحاولة (rate limit)');
}

/* ============ الخرائط ============ */
const ORIGIN = { ko: 'كوري', ja: 'ياباني', zh: 'صيني' };

/* ترجمة أشهر الوسوم إلى العربية (والباقي يبقى بالإنجليزية) */
const TAG_AR = {
  Action: 'أكشن', Romance: 'رومانسي', Fantasy: 'فانتازيا', Drama: 'دراما',
  Adventure: 'مغامرات', Comedy: 'كوميدي', 'Supernatural': 'خارق',
  Isekai: 'إيسيكاي', 'Sci-Fi': 'خيال علمي', Horror: 'رعب', Psychological: 'نفسي',
  Sports: 'رياضة', Thriller: 'إثارة', Mystery: 'غموض', 'Slice of Life': 'شريحة حياة',
  Historical: 'تاريخي', 'Martial Arts': 'فنون قتالية', Tragedy: 'تراجيديا',
  'School Life': 'حياة مدرسية', Seinen: 'سينين', Shounen: 'شونين', Shoujo: 'شوجو',
  Military: 'عسكري', Mecha: 'ميكا', 'Time Travel': 'سفر عبر الزمن', Reincarnation: 'تقمّص'
};
function mapTags(tags) {
  if (!Array.isArray(tags)) return [];
  const names = tags.map(t => t?.attributes?.name?.en).filter(Boolean);
  const ar = names.map(n => TAG_AR[n] || n);
  return [...new Set(ar)].slice(0, 4);
}

/* أفضل عنوان: الإنجليزية أولاً (رسمي ثم بديل) ثم أي لغة */
function bestTitle(a) {
  if (a.title?.en) return a.title.en;
  const enAlt = (a.altTitles || []).find(t => t.en);
  if (enAlt) return enAlt.en;
  if (a.title) { const k = Object.keys(a.title)[0]; if (k) return a.title[k]; }
  const alt = (a.altTitles || [])[0];
  if (alt) { const k = Object.keys(alt)[0]; if (k) return alt[k]; }
  return 'بدون عنوان';
}

function coverURL(mangaId, fileName) {
  if (!fileName) return null;
  return `${UPLOADS}/covers/${mangaId}/${fileName}.512.jpg`;
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

/* تطبيع العمل إلى بنية الواجهة الأمامية */
function normalizeManga(m) {
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
    img: coverURL(m.id, cover?.attributes?.fileName) || null,
    description: (a.description?.en || '').slice(0, 300),
    status: a.status === 'ongoing' ? 'مستمر' : a.status === 'completed' ? 'مكتمل' : 'متوقف'
  };
}

/* ============ الإحصائيات (تقييم + متابعون) ============ */
async function getStats(id) {
  const key = 's:' + id;
  const hit = statsCache.get(key);
  if (hit) return hit;

  for (let i = 0; i <= 3; i++) {
    const res = await fetch(`${BASE}/statistics/manga/${id}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    if (res.status === 429) { await sleep(800 * (i + 1)); continue; }
    if (res.ok) {
      const data = await res.json();
      const s = data.statistics?.[id] || {};
      const out = {
        rating: s.rating?.average ? Math.round(s.rating.average * 10) / 10 : 0,
        follows: s.follows || 0
      };
      statsCache.set(key, out);
      return out;
    }
    await sleep(400);
  }
  return { rating: 0, follows: 0 };
}

/* إثراء قائمة الأعمال بالإحصائيات (دفعات من 5 لاحترام الحد 5/ثانية) */
async function enrichStats(works) {
  const BATCH = 5;
  for (let i = 0; i < works.length; i += BATCH) {
    const chunk = works.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(w => getStats(w.id)));
    chunk.forEach((w, j) => {
      w.rating = results[j].rating;
      w.views = formatCount(results[j].follows);
    });
    if (i + BATCH < works.length) await sleep(1100);
  }
  return works;
}

/* ============ إزالة التكرار ============ */
function dedupe(works) {
  const seen = new Set();
  const out = [];
  for (const w of works) {
    const k = w.id;
    const kt = w.title.trim().toLowerCase();
    if (seen.has(k) || seen.has('t:' + kt)) continue;
    seen.add(k); seen.add('t:' + kt);
    out.push(w);
  }
  return out;
}

/* ============ الدوال العامة ============ */
export async function searchWorks({ origin = null, title = '', page = 1, limit = 30, stats = true } = {}) {
  const key = `w:${origin || 'all'}:${title}:${page}:${limit}:${stats ? 1 : 0}`;
  if (worksCache.has(key)) return worksCache.get(key);

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String((page - 1) * limit),
    'contentRating[]': 'safe',
  });
  params.append('contentRating[]', 'suggestive');
  if (origin && ORIGIN[origin]) params.append('originalLanguage[]', origin);
  if (title) params.set('title', title);
  params.append('order[followedCount]', 'desc');
  params.append('includes[]', 'cover_art');
  // الأعمال ذات الفصول المتاحة فقط (تستبعد العناوين المحذوفة لـ DMCA)
  params.append('hasAvailableChapters', 'true');

  const data = await fetchJSON(`/manga?${params.toString()}`);
  let works = dedupe((data.data || []).map(normalizeManga));
  if (stats && works.length) await enrichStats(works);
  const result = { works, total: data.total || works.length };
  worksCache.set(key, result);
  return result;
}

export async function getWork(id) {
  const key = 'm:' + id;
  if (worksCache.has(key)) return worksCache.get(key);
  const data = await fetchJSON(`/manga/${id}?includes[]=cover_art`);
  const w = normalizeManga(data.data);
  const s = await getStats(id);
  w.rating = s.rating; w.views = formatCount(s.follows);
  worksCache.set(key, w);
  return w;
}

/* أولوية اللغات: نفضّل الإنجليزية ثم العربية ثم الأكثر شيوعاً */
const LANG_PRIORITY = ['en', 'ar', 'fr', 'es', 'pt-br', 'it', 'de', 'tr', 'id', 'vi', 'pl', 'ru'];

export async function getChapters(id) {
  const key = `c:${id}`;
  if (chaptersCache.has(key)) return chaptersCache.get(key);

  // جلب كل الفصول بدون فلتر لغة (بعض الأعمال متاحة بلغات غير الإنجليزية فقط)
  let all = [], offset = 0, total = 0;
  do {
    const params = new URLSearchParams({
      limit: '500', offset: String(offset),
      'order[volume]': 'desc', 'order[chapter]': 'desc',
    });
    const data = await fetchJSON(`/manga/${id}/feed?${params.toString()}`);
    const arr = data.data || [];
    total = data.total || 0;
    all = all.concat(arr);
    offset += arr.length;
    if (!arr.length) break;
  } while (offset < total && all.length < 3000);

  // تحديد اللغة المهيمنة (الأكثر فصولاً) لاستخدامها كترجيح
  const langCount = {};
  for (const c of all) {
    const l = c.attributes?.translatedLanguage;
    if (l) langCount[l] = (langCount[l] || 0) + 1;
  }
  const dominant = Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0];

  function langRank(l) {
    const i = LANG_PRIORITY.indexOf(l);
    return i === -1 ? 999 : i;
  }

  // تجميع حسب رقم الفصل + إزالة التكرار (نأخذ أفضل لغة لكل رقم)
  const byNum = new Map();
  for (const c of all) {
    const a = c.attributes || {};
    const num = a.chapter || a.title || '?';
    const existing = byNum.get(num);
    if (!existing) { byNum.set(num, c); continue; }
    const curL = c.attributes?.translatedLanguage;
    const exL = existing.attributes?.translatedLanguage;
    // الأفضلية: الإنجليزية/العربية أولاً، ثم اللغة المهيمنة، ثم الأحدث
    const curScore = langRank(curL) * 1000 + (curL === dominant ? -100 : 0);
    const exScore = langRank(exL) * 1000 + (exL === dominant ? -100 : 0);
    if (curScore < exScore) byNum.set(num, c);
  }

  const chapters = [...byNum.values()]
    .sort((a, b) => {
      const na = parseFloat(a.attributes?.chapter) || 0;
      const nb = parseFloat(b.attributes?.chapter) || 0;
      return nb - na;
    })
    .map(c => ({
      id: c.id,
      number: c.attributes?.chapter || c.attributes?.title || '?',
      title: c.attributes?.title || '',
      volume: c.attributes?.volume || '',
      pages: c.attributes?.pages || 0,
      publishedAt: c.attributes?.publishAt,
      time: relTime(c.attributes?.publishAt),
      translatedLanguage: c.attributes?.translatedLanguage
    }));

  chaptersCache.set(key, chapters);
  return chapters;
}

export async function getPages(chapterId) {
  const key = 'p:' + chapterId;
  if (pagesCache.has(key)) return pagesCache.get(key);
  const data = await fetchJSON(`/at-home/server/${chapterId}`);
  const { baseUrl, chapter } = data;
  const pages = (chapter.data || []).map(f => `${baseUrl}/data/${chapter.hash}/${f}`);
  pagesCache.set(key, pages);
  return pages;
}

export const ORIGINS = ORIGIN;
