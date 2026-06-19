# IntelliQuote Web (SPA React)

SPA independente do IntelliQuote, hospedada no Firebase Hosting (`intelliquote`).
Autentica via Firebase Auth (projeto compartilhado com o Portal COMEX) e troca o ID
token pelo JWT IntelliQuote em `POST /api/v1/auth/firebase`.

## Stack
- React 18 + TypeScript + Vite 5
- React Router 6
- TanStack Query 5
- Firebase Web SDK 10

## Setup local
```bash
cd programa/web
cp .env.example .env.local   # editar com credenciais do Firebase
npm install
npm run dev                  # http://localhost:5173
```

A aplicação espera que o backend rode em `http://localhost:3000` (proxy automático
do Vite para `/api`).

## Build
```bash
npm run build                # gera ./dist
```

## Deploy
O Firebase Hosting (`Portal COMEX/sq-comex-updates/firebase.intelliquote.json`)
aponta para `../../Intelliquote/programa/web/dist`. Após o build, basta:
```bash
cd "Portal COMEX/sq-comex-updates"
firebase deploy --only hosting:intelliquote -c firebase.intelliquote.json
```

## Variáveis de ambiente
| Nome | Descrição |
|---|---|
| `VITE_FIREBASE_API_KEY` | API Key do Firebase Web SDK (público) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Domínio de auth (`<project>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | ID do projeto Firebase |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID |
| `VITE_FIREBASE_APP_ID` | App ID do Web App |
| `VITE_INTELLIQUOTE_API_BASE` | Base da API (`/api` em prod) |
| `VITE_PORTAL_URL` | URL do Portal COMEX (botão de login) |
