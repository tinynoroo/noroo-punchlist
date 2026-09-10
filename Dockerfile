FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public
COPY views ./views

RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node
EXPOSE 8000
CMD ["node", "server.js"]
