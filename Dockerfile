FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
