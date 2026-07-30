FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY src ./src

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/index.js"]
