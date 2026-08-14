/* ============================================================
   أوريون · توونز — محرك ManhuaPlus النظيف (بدون مكتبات خارجية)
   ============================================================ */
import express from 'express';
import cors from 'cors';

const app = express();
app.disable('x-powered-by');

const BASE_URL = 'https://manhuaplus.com';
const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json());

// جلب الصفحات مع تجاوز الحظر
async function fetchHTML(url, method = 'GET') {
  const response = await fetch(url, {
    method: method,
    headers: {
      'User-Agent': UA,
      'Referer': BASE_URL,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  return await response.text();
}

// استخراج النصوص بين وسمين (بدون الحاجة لـ Cheerio)
function extractBetween(str, startStr, endStr) {
  const start = str.indexOf(startStr);
  if (start === -1) return [];
  const results = [];
  let curr = start;
  while (curr !== -1) {
    curr += startStr.length;
    const end = str.indexOf(endStr, curr);
    if (end === -1) break;
    results.push(str.substring(curr, end));
    curr = str.indexOf(startStr, end);
  }
  return results;
}

/* ===== 1. قائمة الأعمال (مع منع التكرار) ===== */
app.get('/api/works', async (req, res) => {
  try {
    const page = req.query.page || 1;
    const html = await fetchHTML(`${BASE_URL}/manga/page/${page}/`);
    
    const works = [];
    const seen = new Set();
    
    // تقطيع HTML حسب عناصر المانجا
    const items = html.split('page-item-detail manga');
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      
      // استخراج الرابط والعنوان
      const aMatch = item.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      // استخراج الصورة
      const imgMatch = item.match(/data-src="([^"]+)"/) || item.match(/src="([^"]+)"/);
      
      if (aMatch) {
        const url = aMatch[1];
        const title = aMatch[2].trim();
        const id = url.replace(BASE_URL + '/manga/', '').replace(/\//g, '');
        const imgUrl = imgMatch ? imgMatch[1].trim() : '';

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const hostUrl = `${protocol}://${req.get('host')}`;

        if (id && !seen.has(id) && title) {
          seen.add(id);
          works.push({
            id,
            title,
            latest: 'متاح',
            img: `${hostUrl}/api/image?url=${encodeURIComponent(imgUrl)}`
          });
        }
      }
    }

    res.json({ page: parseInt(page), works });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

/* ===== 2. تفاصيل العمل وجميع الفصول مرتبة تصاعدياً ===== */
app.get('/api/works/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mangaUrl = `${BASE_URL}/manga/${id}/`;
    
    const html = await fetchHTML(mangaUrl);
    
    // استخراج العنوان
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : id;
    
    // استخراج الصورة الرئيسية
    const imgMatch = html.match(/summary_image[^>]*>[\s\S]*?src="([^"]+)"/) || html.match(/summary_image[^>]*>[\s\S]*?data-src="([^"]+)"/);
    const imgUrl = imgMatch ? (imgMatch[1] || imgMatch[2]) : '';

    // جلب الفصول عبر طلب الـ Ajax الخاص بالموقع
    const chaptersHtml = await fetchHTML(`${mangaUrl}ajax/chapters/`, 'POST');
    
    let chapters = [];
    const chapterItems = chaptersHtml.split('wp-manga-chapter');
    
    for (let i = 1; i < chapterItems.length; i++) {
      const item = chapterItems[i];
      const match = item.match(/href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      if (match) {
        const chapUrl = match[1];
        const chapTitle = match[2].trim();
        const chapId = chapUrl.replace(mangaUrl, '').replace(/\//g, '');
        
        if (chapId && !chapters.some(c => c.id === chapId)) {
          chapters.push({ id: chapId, title: chapTitle });
        }
      }
    }

    // عكس الفصول لتبدأ من الفصل الأول إلى الأخير
    chapters = chapters.reverse();

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const hostUrl = `${protocol}://${req.get('host')}`;

    res.json({
      id,
      title,
      description: 'متاح عبر ManhuaPlus',
      genres: [],
      img: imgUrl ? `${hostUrl}/api/image?url=${encodeURIComponent(imgUrl)}` : null,
      totalChapters: chapters.length,
      chapters
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

/* ===== 3. صفحات الفصل ===== */
app.get('/api/chapters/:mangaId/:chapterId/pages', async (req, res) => {
  try {
    const { mangaId, chapterId } = req.params;
    const chapterUrl = `${BASE_URL}/manga/${mangaId}/${chapterId}/`;
    
    const html = await fetchHTML(chapterUrl);
    
    const pages = [];
    const imgRegex = /<img[^>]+(?:data-src|src)="([^"]+)"[^>]*>/g;
    let match;
    
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1].trim();
      // تصفية صور القراءة فقط
      if (src && (src.includes('ib.metabox') || src.includes('wp-content/uploads') || src.includes('manga'))) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const hostUrl = `${protocol}://${req.get('host')}`;
        pages.push(`${hostUrl}/api/image?url=${encodeURIComponent(src)}`);
      }
    }

    // إزالة التكرار من الصور إن وجد
    const uniquePages = [...new Set(pages)];

    res.json({ total: uniquePages.length, pages: uniquePages });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

/* ===== 4. وكيل الصور (Image Proxy) ===== */
app.get('/api/image', async (resq, res) => {
  try {
    const imageUrl = resq.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'No URL provided' });

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

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(data);
  } catch (e) {
    res.status(404).json({ error: 'Image not found' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});