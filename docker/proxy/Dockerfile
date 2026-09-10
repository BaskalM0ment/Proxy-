FROM node:22-alpine

WORKDIR /app

COPY docker/proxy/package.json ./package.json
RUN npm install --omit=dev

COPY docker/proxy/server.js ./server.js
COPY index.html ./public/index.html
COPY style.css ./public/style.css
COPY app.js ./public/app.js

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.js"]
