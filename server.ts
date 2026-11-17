import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { posApiRouter } from './server/posApi';
import { thermalPrintRouter } from './server/thermalPrintRouter';

// Load environment variables if available
dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mount POS Synchronization and Dual Thermal Printer ESC/POS APIs
app.use('/api/pos', posApiRouter);
app.use('/api/print', thermalPrintRouter);

// General health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    system: 'El Basha Grill POS Backend',
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  const server = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const hmrConfig = process.env.DISABLE_HMR === 'true' ? false : { server };
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrConfig,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[El Basha Server] Running on http://0.0.0.0:${PORT}`);
    console.log(`[POS Sync API] Cloud queue mounted at http://0.0.0.0:${PORT}/api/pos/orders/poll`);
  });
}

startServer();
