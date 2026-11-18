import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createApiRouter } from './server/routes/api.ts';
import { cleanupOrphanedTempFiles, ensureStorageDirs } from './server/utils/storage.ts';

function resolveServerPort(isProd: boolean): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      const p = Number(args[i + 1]);
      if (Number.isFinite(p) && p > 0) return p;
    } else if (arg.startsWith('--port=')) {
      const p = Number(arg.slice('--port='.length));
      if (Number.isFinite(p) && p > 0) return p;
    }
  }

  const envPort = Number(process.env.PORT);
  if (isProd) {
    return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
  }

  // In AI Studio Cloud Run dev mode, nginx owns port 8080 and proxies to dev server on 3000.
  if (Number.isFinite(envPort) && envPort > 0 && envPort !== 8080) {
    return envPort;
  }
  return 3000;
}

async function startServer() {
  ensureStorageDirs();

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const PORT = resolveServerPort(isProd);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount REST API immediately so /api/health responds right away
  app.use('/api', createApiRouter());

  // Error handler for API routes
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  if (!isProd) {
    // Initialize Vite dev middleware without blocking port 3000 binding
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
        },
        appType: 'spa',
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ClipForge AI] Server running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    // Run orphaned temp cleanup asynchronously after port binds
    setImmediate(() => {
      try {
        cleanupOrphanedTempFiles(24);
      } catch (err) {
        console.warn('[ClipForge AI] Temp cleanup skipped:', err);
      }
    });
  });

  // Allow unlimited upload and processing duration without premature socket timeout
  server.requestTimeout = 0;
}

startServer().catch((err) => {
  console.error('[ClipForge AI] Failed to start server:', err);
  process.exit(1);
});
