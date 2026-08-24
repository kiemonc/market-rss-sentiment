FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# For local container testing only — actual GCP deployment uses Terraform +
# the Cloud Functions buildpack (see terraform/), not this image.
CMD ["npm", "start"]
