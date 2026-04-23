FROM node:20-bookworm

WORKDIR /app

# ติดตั้ง tool สำหรับคอมไพล์ native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# ล้างและติดตั้งใหม่ใน Container เท่านั้น
RUN rm -rf node_modules && npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
