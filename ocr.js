/* ترجمة OCR حقيقية — قابلة للتوصيل بأي مزوّد رؤية (Vision)
   المزوّد يُختار من متغيّر البيئة OCR_PROVIDER
   يعمل مع: anthropic (Claude) / openai (GPT-4o) / gemini */

const LANGS = {
  ar: 'العربية (Arabic)',
  en: 'الإنجليزية (English)',
  fr: 'الفرنسية (French)',
  tr: 'التركية (Turkish)',
  es: 'الإسبانية (Spanish)',
  de: 'الألمانية (German)'
};

function promptFor(target) {
  const lang = LANGS[target] || target;
  return `أنت مترجم مانغا محترف. هذه صورة صفحة مانغا تحتوي فقاعات نصية (بالكورية/اليابانية/الصينية أو الإنجليزية).
اقرأ كل النص الظاهر في الصورة، ثم ترجمه كاملاً إلى ${lang}.
أعد الترجمة فقط كنص عادي، بدون أي شرح أو تنسيق. حافظ على ترتيب الفقاعات وافصل بينها بأسطر جديدة.`;
}

async function callAnthropic(imageUrl, target) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY غير معرّف');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: promptFor(target) }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

async function callOpenAI(imageUrl, target) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY غير معرّف');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: promptFor(target) },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGemini(imageUrl, target) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY غير معرّف');
  // جلب الصورة كـ base64 (Gemini يتطلب بيانات مضمنة)
  const imgRes = await fetch(imageUrl);
  const buf = await imgRes.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: promptFor(target) },
          { inline_data: { mime_type: mime, data: b64 } }
        ] }]
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('')?.trim() || '';
}

/* نقطة الدخول: تعيد النص المترجم أو null إذا لم يتوفر مزوّد */
export async function translateImage(imageUrl, target = 'ar') {
  if (!imageUrl) throw new Error('imageUrl مطلوب');
  const provider = process.env.OCR_PROVIDER || 'anthropic';

  switch (provider) {
    case 'anthropic': return callAnthropic(imageUrl, target);
    case 'openai':    return callOpenAI(imageUrl, target);
    case 'gemini':    return callGemini(imageUrl, target);
    default: throw new Error(`مزوّد OCR غير معروف: ${provider}`);
  }
}

export function isConfigured() {
  const p = process.env.OCR_PROVIDER || 'anthropic';
  if (p === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  if (p === 'openai')    return !!process.env.OPENAI_API_KEY;
  if (p === 'gemini')    return !!process.env.GEMINI_API_KEY;
  return false;
}
