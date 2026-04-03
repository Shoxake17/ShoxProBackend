# 1. Node.js ning barqaror versiyasini olamiz
FROM node:20-alpine

# 2. Ishchi papkani yaratamiz
WORKDIR /app

# 3. Faqat package fayllarini ko'chiramiz (keshni optimallashtirish uchun)
COPY package*.json ./

# 4. Kutubxonalarni o'rnatamiz
RUN npm install --production

# 5. Qolgan barcha kodlarni ko'chiramiz
COPY . .

# 6. Backend portini ochamiz
EXPOSE 4000

# 7. Serverni ishga tushiramiz
CMD ["node", "server.js"]