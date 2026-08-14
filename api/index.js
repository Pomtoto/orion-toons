import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const BASE = 'https://api.mangadex.org';
const UA = 'OrionToons/2.0';

// وسيط MangaDex ذكي:
// 1) يمرر المسار الأصلي كما هو
// 2) ينظف المعاملات الخاطئة (includeEmptyPages, erotica, pornographic)
// 3) إذا طلب فصول بلغة محددة ورجع 0، يعيد المحاولة بكل اللغات
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

    // تنظيف المعاملات الخاطئة من الرابط (يشمل الترميز %5B%5D)
    let cleanUrl = url
      .replace(/&?includeEmptyPages=\d+/g, '')
      .replace(/&?contentRating(%5B%5D|\[\])=(erotica|pornographic)/gi, '');

    let result = await doFetch(cleanUrl);

    // إذا كان طلب فصول (feed) ورجع 0 نتائج بسبب فلتر اللغة، جرب بدون فلتر اللغة
    if (result.status === 200 && url.includes('/feed')) {
      let empty = false;
      try {
        const d = result.body;
        empty = d && Array.isArray(d.data) && d.data.length === 0;
      } catch (_) {}
      if (empty) {
        // إزالة فلتر اللغة (بكلا الترميزين) وإعادة المحاولة
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
  res.json({ ok: true, name: 'Orion Toons' });
});

export default app;
