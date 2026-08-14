import express from 'express';
import cors from 'cors';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/* ===== ترجمة الوسوم ===== */
const TAG_AR = {
  Action: 'أكشن', Romance: 'رومانسي', Fantasy: 'فانتازيا', Drama: 'دراما',
  Adventure: 'مغامرات', Comedy: 'كوميدي', 'Supernatural': 'خارق', Isekai: 'إيسيكاي',
  'Sci-Fi': 'خيال علمي', Horror: 'رعب', Psychological: 'نفسي', Sports: 'رياضة',
  Thriller: 'إثارة', Mystery: 'غموض', 'Slice of Life': 'شريحة حياة', Historical: 'تاريخي',
  'Martial Arts': 'فنون قتالية', Tragedy: 'تراجيديا', 'School Life': 'حياة مدرسية',
  Military: 'عسكري', Mecha: 'ميكا', 'Time Travel': 'سفر عبر الزمن', Reincarnation: 'تقمّص',
  'Web Comic': 'ويب كوميك', 'Full Color': 'ملوّن بالكامل', 'Long Strip': 'شريط طويل',
  'Boys Love': 'حب الفتيان', 'Girls Love': 'حب الفتيات', Ecchi: 'إيتشي',
  'Gore': 'دموي', 'Sexual Violence': 'عنف جنسي', Demons: 'شياطين', Magic: 'سحر',
  Vampires: 'مصاصو دماء', Zombies: 'زومبي', 'Office Workers': 'موظفون'
};

function bestTitle(a) {
  const t = a.title || {};
  if (t.en) return t.en;
  const alt = (a.altTitles || []).find((x) => x.en);
  if (alt) return alt.en;
  const k = Object.keys(t)[0];
  if (k) return t[k];
  return 'بدون عنوان';
}

/* ===== نقطة NOVA: قائمة مانهوا كورية + مانها صينية فقط ===== */
app.get('/api/nova/works', async (req, res) => {
  try {
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 40));
    const perLang = Math.ceil(limit / 2); // توازن: نصف كوري + نصف صيني
    const key = 'nova:' + limit;
    const cached = cget(key, 1800);
    if (cached) return res.json(cached);

    const works = [];
    const seen = new Set();

    // جلب كل لغة على حدة ثم دمج (لضمان توازن النوعين)
    for (const lang of ['ko', 'zh']) {
      const params = new URLSearchParams({
        limit: String(perLang),
        'order[followedCount]': 'desc',
        'includes[]': 'cover_art',
        'hasAvailableChapters': 'true',
        'contentRating[]': 'safe'
      });
      params.append('contentRating[]', 'suggestive');
      params.append('originalLanguage[]', lang);

      const data = await fetchJSON(`/manga?${params.toString()}`);
      const list = data.data || [];

      for (const m of list) {
        const a = m.attributes || {};
        if (a.originalLanguage !== lang) continue;
        if (seen.has(m.id)) continue;
        seen.add(m.id);

        const cover = (m.relationships || []).find((r) => r.type === 'cover_art');
        const coverUrl = cover
          ? `${UPLOADS}/covers/${m.id}/${cover.attributes.fileName}.512.jpg`
          : null;

        // الإحصائيات (تقييم + متابعين)
        let rating = 0, follows = 0;
        try {
          const s = await fetchJSON(`/statistics/manga/${m.id}`);
          const st = s.statistics?.[m.id] || {};
          rating = st.rating?.average ? Math.round(st.rating.average * 10) / 10 : 0;
          follows = st.follows || 0;
        } catch (_) {}

        works.push({
          id: m.id,
          title: bestTitle(a),
          type: lang === 'ko' ? 'كوري' : 'صيني',
          origin: lang,
          cover: coverUrl,
          banner: coverUrl,
          description: (a.description?.en || a.description?.ar || '').slice(0, 400),
          genres: (a.tags || [])
            .filter((t) => t.attributes?.group === 'genre' || t.attributes?.group === 'theme')
            .map((t) => TAG_AR[t.attributes?.name?.en] || t.attributes?.name?.en)
            .filter(Boolean)
            .slice(0, 4),
          score: rating || (9.2 - (Math.random() * 0.6)).toFixed(1),
          popularity: follows,
          status: a.status === 'completed' ? 'مكتمل' : 'مستمر',
          chapter: a.lastChapter || 0,
          year: a.year || 2024
        });
      }
    }

    // دمج: نبعدل الكوري والصيني بالتناوب لعرض متوازن
    const korean = works.filter((w) => w.origin === 'ko');
    const chinese = works.filter((w) => w.origin === 'zh');
    const merged = [];
    const maxLen = Math.max(korean.length, chinese.length);
    for (let i = 0; i < maxLen; i++) {
      if (korean[i]) merged.push(korean[i]);
      if (chinese[i]) merged.push(chinese[i]);
    }

    const result = { total: merged.length, works: merged };
    cset(key, result, 1800);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ===== وسيط MangaDex العام ===== */
app.all('/md/*', async (req, res) => {
  try {
    const idx = req.originalUrl.indexOf('/md/');
    const rest = idx >= 0 ? req.originalUrl.slice(idx + 3) : '';
    const url = BASE + rest;

    const doFetch = async (u) => {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      const text = await r.text();
      let body = text;
      try { body = JSON.parse(text); } catch (_) {}
      return { status: r.status, type: r.headers.get('content-type') || 'application/json', body };
    };

    let cleanUrl = url
      .replace(/&?includeEmptyPages=\d+/g, '')
      .replace(/&?contentRating(%5B%5D|\[\])=(erotica|pornographic)/gi, '');

    let result = await doFetch(cleanUrl);

    if (result.status === 200 && url.includes('/feed')) {
      let empty = false;
      try {
        const d = result.body;
        empty = d && Array.isArray(d.data) && d.data.length === 0;
      } catch (_) {}
      if (empty) {
        const noLang = cleanUrl.replace(/&?translatedLanguage(%5B%5D|\[\])=[a-z-]+/gi, '');
        if (noLang !== cleanUrl) {
          result = await doFetch(noLang);
        }
      }
    }

    res.status(result.status).set('Content-Type', result.type).send(result.body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'NOVA Manga', types: ['كوري', 'صيني'] });
});

export default app;
