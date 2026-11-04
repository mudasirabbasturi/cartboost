FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0

EXPOSE 7860

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

RUN npm prune --production

CMD ["npm", "run", "docker-start"]
