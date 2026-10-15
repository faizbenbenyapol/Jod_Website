# แอปไม่มี dependency ภายนอก จึงไม่ต้อง npm install แค่คัดลอกโค้ดแล้วรันด้วย Node
FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# โฟลเดอร์เก็บข้อมูล (db.json) ให้ผู้ใช้ node เขียนได้ และแยกเป็น volume เพื่อไม่ให้ข้อมูลหายเมื่อสร้าง container ใหม่
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
