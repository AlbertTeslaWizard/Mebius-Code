# Mebius Code Web

Vue 3 + TypeScript frontend for the Mebius Code workspace.

## Local Development

```bash
npm install
npm run dev
```

The Vite dev server runs on `http://127.0.0.1:5173` and proxies `/api` to
`http://localhost:3000`.

Start the backend first:

```bash
cd ../backend
npm run start:dev
```

## Quality Checks

```bash
npm run typecheck
npm run build
```
