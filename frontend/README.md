# MQTT Dashboard — Frontend

Single Page Application (SPA) for MQTT Dashboard built with React 19, TypeScript, Vite, Tailwind CSS v4, and DaisyUI v5.

## 🚀 Getting Started

### Prerequisites

- Node.js 22+ (or 20+)
- npm 10+

### Development

In development mode, Vite starts a dev server with Hot Module Replacement (HMR) and automatically proxies `/api` and `/ws` requests to the backend running at `http://localhost:8080`.

```bash
# Install dependencies
npm ci

# Start Vite dev server on http://localhost:5173
npm run dev
```

Running the frontend standalone this way expects a Go backend on port 8080. The usual
workflow is the full Docker dev stack instead — `make dev-start` from the repo root, which
runs frontend and backend together and serves them at `http://<worktree>.localhost`
(`make dev-url`). See [`AGENTS.md`](../AGENTS.md).

### Production Build

```bash
# Type check and build static production bundle into dist/
npm run build
```

When building for production, the compiled assets in `frontend/dist/` are embedded directly into the Go backend binary using `embed.FS`.

---

## 📁 Project Structure

```
frontend/
├── public/                 # Static assets (logo, favicon)
├── src/
│   ├── api/                # HTTP API client functions (brokers, dashboards, layouts, settings, etc.)
│   ├── components/         # Reusable UI components
│   │   ├── explorer/       # MQTT Topic Explorer tree, breadcrumbs, topic picker
│   │   └── panels/         # Dashboard panels (Gauge, Button, Input, Log, Cron, Stats, Image, Separator, Text)
│   ├── data/               # Starter dashboard templates and default presets
│   ├── hooks/              # Custom React hooks (e.g. useWebSocket, broker/layout state)
│   ├── pages/              # Primary route views
│   │   ├── DashboardPage.tsx  # Multi-dashboard workspace with drag-and-drop grid
│   │   ├── ExplorerPage.tsx   # Topic explorer, message history viewer, live monitor
│   │   └── ConfigPage.tsx     # Broker manager, TLS/mTLS credentials, retention settings
│   ├── test/               # Vitest test setup and utilities
│   ├── utils/              # Helper utilities (date formatting, topic matching, etc.)
│   ├── App.tsx             # Root app router and shell layout
│   └── main.tsx            # Application entry point
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ Available Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start local Vite development server with proxying to `:8080` |
| `npm run build` | Run TypeScript type checks (`tsc -b`) and bundle for production (`dist/`) |
| `npm run test` | Run unit tests using Vitest in single-run mode |
| `npm run test:watch` | Run Vitest in interactive watch mode |
| `npm run lint` | Check code with ESLint |
| `npm run prettier` | Format codebase using Prettier |
| `npm run preview` | Locally preview the production build in `dist/` |

---

## 🧩 Key Technologies & Libraries

- **UI Framework:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite 8](https://vitejs.dev/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/) + [DaisyUI v5](https://daisyui.com/)
- **Grid Layout:** [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)
- **Drag & Drop:** [@dnd-kit](https://dndkit.com/)
- **Routing:** [React Router 7](https://reactrouter.com/)
- **Cron Formatter:** [cronstrue](https://github.com/bradymholt/cronstrue)
- **Testing:** [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/)

