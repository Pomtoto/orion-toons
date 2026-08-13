# أوريون توونز — صورة Docker للنشر
FROM node:20-alpine
WORKDIR /app

# نسخ ملفات التبعيات أولاً (للاستفادة من كاش الطبقات)
COPY package*.json ./
RUN npm ci --omit=dev

# نسخ باقي الكود
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
