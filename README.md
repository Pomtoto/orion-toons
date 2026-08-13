# ✦ أوريون · توونز — ثورة القراءة العربية

<div dir="rtl">

منصّة عربية متكاملة لقراءة **المانهوا الكورية** 🇰🇷 و**المانها الصينية** 🇨🇳 و**المانغا اليابانية** 🇯🇵 — بواجهة عربية أنيقة (RTL)، مع فصول وصفحات حقيقية، وترجمة OCR فورية بالذكاء الاصطناعي.

</div>

![Orion Toons](https://img.shields.io/badge/Node-≥18-green) ![Express](https://img.shields.io/badge/Express-4-blue) ![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## ✨ المزايا

- 🌍 **الأنواع الثلاثة** من مصدر موحّد موثوق (كوري / صيني / ياباني)
- 📚 **فصول وصفحات حقيقية** بدون أي تكرار
- 🤖 **ترجمة OCR فورية** (Claude / GPT-4o / Gemini) من الصور مباشرة
- 🔍 **بحث فوري** من المصدر أثناء الكتابة
- 📄 **صفحة تفاصيل كاملة** لكل عمل (وصف + إحصائيات + قائمة فصول)
- 💾 **حفظ تقدّم القراءة** (IndexedDB) + استئناف تلقائي
- 📱 **PWA** — يعمل دون إنترنت وقابل للتثبيت كتطبيق
- 🌗 وضع ليلي/نهاري + تجربة عربية كاملة (RTL)

---

## 🚀 التشغيل المحلي

```bash
git clone https://github.com/USER/orion-toons.git
cd orion-toons
npm install
cp .env.example .env        # ثم عدّل المفاتيح (اختياري)
npm start                   # → http://localhost:3000
```

---

## 🌐 النشر

### ✅ مجاني 100% (الطريقة الموصى بها)

انشر على **Vercel** — مجاني دائم، لا ينام، مع HTTPS ودومين مجاني:

1. ارفع المشروع على GitHub
2. في [vercel.com](https://vercel.com): **Add New → Project → Import** المستودع
3. اضغط **Deploy** — الملفات `vercel.json` + `api/index.js` ستشغّل كل شيء تلقائياً

> 📖 راجع ملف `نشر-مجاني.md` للخطوات الكاملة بالتفصيل.

### الطريقة 2 — Render.com (مجاني لكن ينام بعد خمول)

1. ارفع المشروع إلى GitHub.
2. في [Render](https://render.com): **New + → Web Service** → اربط المستودع.
3. **Build**: `npm install` — **Start**: `npm start`
4. متغير `PORT` = `3000`
5. **Deploy** → رابط `https://…onrender.com`

### الطريقة 3 — Docker / VPS

```bash
docker build -t orion-toons .
docker run -p 3000:3000 --env-file .env orion-toons
```

---

## 🔌 واجهة الـ API

| النقطة | الوصف |
|---|---|
| `GET /api/health` | فحص الحالة |
| `GET /api/works?origin=ko\|ja\|zh&title=&page=&limit=` | قائمة الأعمال |
| `GET /api/works/:id` | تفاصيل عمل (وصف + إحصائيات) |
| `GET /api/works/:id/chapters` | كل الفصول (بدون تكرار) |
| `GET /api/chapters/:id/pages` | روابط صفحات الفصل |
| `POST /api/ocr` | `{ imageUrl, target }` → `{ text }` |

---

## 🤖 تفعيل OCR

في `.env` اختر مزوّداً واحداً:
```env
OCR_PROVIDER=anthropic          # أو openai / gemini
ANTHROPIC_API_KEY=sk-ant-...
```
بدون مفتاح، يعمل الموقع كاملاً (قراءة + فصول) وتتعطّل الترجمة الفورية فقط.

---

## 🗂 البنية

```
├── server.js            ← التشغيل المحلي
├── app.js               ← تطبيق Express (المسارات)
├── api/index.js         ← نقطة دخول Vercel (Serverless)
├── vercel.json          ← إعداد النشر على Vercel
├── Dockerfile / render.yaml
├── public/              ← الواجهة الأمامية (index.html + PWA)
└── lib/
    ├── mangadex.js      ← عميل المصدر (بحث/فصول/صفحات)
    ├── ocr.js           ← ترجمة الصور (Claude/OpenAI/Gemini)
    └── cache.js         ← كاش TTL
```

---

## 📄 الترخيص

MIT — استخدمه وطوّره كما تشاء.
