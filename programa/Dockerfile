# syntax=docker/dockerfile:1.7
#
# IntelliQuote Backend - Dockerfile multi-stage.
#
# Stack alvo:
# - Backend Node 22 (Express + Prisma + Firebase Admin) servindo /api/** no Cloud Run
#   (revisado: A Fase 5.D migrou o frontend vanilla JS para React + Vite hospedado
#   no Firebase Hosting via "Portal COMEX/sq-comex-updates/firebase.intelliquote.json".
#   O backend agora e APENAS API: nao ha mais `public/index.html` legacy sendo servido
#   pela rota / nem `app.js` em public/. O portal do fornecedor (`public/portal.html`)
#   continua sendo servido pelo backend em /portal porque os links publicos batem
#   diretamente no Cloud Run.)
#
# Notas operacionais:
# - Mantemos o passo `npm run build:web` para garantir que `dist/public/portal.html`
#   chegue no container; o `copy-web.js` continua sendo util ate a Fase 8 (cleanup).
# - O healthcheck consulta `/health/ready`, exposto em `src/app.ts` antes do static.
# - Em producao, prisma migrations rodam via `npx prisma migrate deploy` no CMD.
# - Nao usamos Alpine porque Prisma + sharp + bcrypt prebuilt preferem glibc.

FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/intelliquote"
ENV DIRECT_URL="postgresql://postgres:postgres@localhost:5432/intelliquote"

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN npm run prisma:generate
RUN npm run build
# Empacota explicitamente o template HTML do e-mail para que esteja
# disponivel dentro de dist/src/mailer/templates em runtime (usado
# por renderQuoteDispatch via fs.readFileSync).
RUN mkdir -p dist/src/mailer/templates && cp src/mailer/templates/*.html dist/src/mailer/templates/
# Mantem a copia de public/ -> dist/public/ ate a Fase 8 remover
# os arquivos legados de vanilla JS.
RUN npm run build:web

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Apenas o necessario para rodar a API + portal do fornecedor.
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "./scripts/healthcheck.js", "http://127.0.0.1:8080/health/ready"]

# Em Cloud Run, `prisma migrate deploy` e idempotente e roda antes de aceitar trafego.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
