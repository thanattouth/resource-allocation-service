FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY README.md ./README.md

EXPOSE 3000

CMD ["npm", "start"]
