/* ============================================================
   أوريون · توونز — خادم سحب البيانات من ManhuaPlus
   متطلبات: npm install express cors cheerio
   ============================================================ */
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';

const app = express();
app.disable('x-powered-by');

const BASE_URL = 'https://manhuaplus.com';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// أداة مساعدة لجلب الصفحات وتخطي الحماية
async function fetchHTML(url, method = 'GET') {
  const response = await fetch(url, {
    method: method,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      'Referer': BASE_URL,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  return await response.text();
}

/* ===== 1. جلب قائمة الأعمال (مع منع التكرار) ===== */
app.get('/api/works', async (req, res) => {
  try {
    const page = req.query.page || 1;
    // جلب أحدث المانجات من الموقع
    const html = await fetchHTML(`${BASE_URL}/manga/page/${page}/`);
    const $ = cheerio.load(html);
    
    const works = [];
    const seen = new Set(); // لمنع التكرار
    
    // سحب البيانات من قالب الموقع (Madara Theme)
    $('.page-item-detail.manga').each((i, el) => {
      const titleElement = $(el).find('.post-title h3 a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href');
      
      // استخراج ID (الرابط المبسط) من الرابط الأصلي
      const id = url ? url.replace(BASE_URL + '/manga/', '').replace('/', '') : null;
      
      const imgElement = $(el).find('.item-thumb img');
      // بعض الصور تستخدم data-src للـ Lazy Loading
      let imgUrl = imgElement.attr('data-src') || imgElement.attr('src');
      if (imgUrl) imgUrl = imgUrl.trim();

      const latestChapter = $(el).find('.chapter-item .chapter a').first().text().trim();

      // التأكد من عدم وجود المانجا مسبقاً وتوفر الـ ID
      if (id && !seen.has(id)) {
        seen.add(id);
        works.push({
          id,
          title,
          latest: latestChapter || 'غير متوفر',
          // توجيه الصورة إلى الوكيل الخاص بنا
          img: `/api/image?url=${encodeURIComponent(imgUrl)}`
        });
      }
    });

    res.json({ page: parseInt(page), works });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Failed to fetch works from ManhuaPlus' });
  }
});

/* ===== 2. جلب تفاصيل المانجا وجميع الفصول (من الأول للأخير) ===== */
app.get('/api/works/:id', async (req, res) => {
  try {
    const { id } = req.params;
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

    // سحب الفصول (في موقع ManhuaPlus الفصول تُجلب عبر POST Request)
    const chaptersHtml = await fetchHTML(`${mangaUrl}ajax/chapters/`, 'POST');
    const $ch = cheerio.load(chaptersHtml);
    
    let chapters = [];
    $ch('li.wp-manga-chapter').each((i, el) => {
      const a = $(el).find('a');
      const chapTitle = a.text().trim();
      const chapUrl = a.attr('href');
      
      // استخراج معرف الفصل من الرابط
      const chapId = chapUrl ? chapUrl.replace(mangaUrl, '').replace('/', '') : null;
      
      if (chapId) {
        chapters.push({
          id: chapId,
          title: chapTitle,
          url: chapUrl
        });
      }
    });

    // عكس المصفوفة لتبدأ الفصول من الأول (مثال: فصل 1، فصل 2...)
    chapters = chapters.reverse();

    res.json({
      id,
      title,
      description,
      genres,
      img: `/api/image?url=${encodeURIComponent(imgUrl)}`,
      totalChapters: chapters.length,
      chapters
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Failed to fetch manga details' });
  }
});

/* ===== 3. جلب صفحات (صور) الفصل ===== */
app.get('/api/chapters/:mangaId/:chapterId', async (req, res) => {
  try {
    const { mangaId, chapterId } = req.params;
    const chapterUrl = `${BASE_URL}/manga/${mangaId}/${chapterId}/`;
    
    const html = await fetchHTML(chapterUrl);
    const $ = cheerio.load(html);
    
    const pages = [];
    // سحب جميع الصور من داخل محتوى الفصل
    $('.reading-content img').each((i, el) => {
      let src = $(el).attr('data-src') || $(el).attr('src');
      if (src) {
        src = src.trim();
        // نمرر الصور عبر الوكيل لتخطي الحظر
        pages.push(`/api/image?url=${encodeURIComponent(src)}`);
      }
    });

    res.json({ total: pages.length, pages });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Failed to fetch chapter pages' });
  }
});

/* ===== 4. وكيل الصور (Image Proxy) لتخطي حظر ManhuaPlus ===== */
app.get('/api/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ error: 'No URL provided' });

    const response = await fetch(imageUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Referer': BASE_URL,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    const data = Buffer.from(buffer);

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // كاش لمدة 7 أيام
    res.send(data);
  } catch (e) {
    console.error('Image proxy error:', e.message);
    res.status(404).json({ error: 'Image not found' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.listen(PORT, () => {
  console.log(`ManhuaPlus Scraper running on port ${PORT}`);
});