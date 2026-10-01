# Imagen única para los tres servicios; SERVICIO elige cuál corre (auth, conteo, resultados).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY data/ubigeo.json ./data/ubigeo.json
COPY data/seed ./data/seed
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
