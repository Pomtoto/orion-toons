/* تشغيل محلي — للمعاينة والتطوير */
import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ أوريون توونز يعمل على http://localhost:${PORT}`);
});
