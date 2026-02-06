/**
 * Express server for the thumbnail editor
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generateThumbnail, setAssetsDir } from './generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const DEFAULT_ASSETS_DIR = join(ROOT_DIR, 'assets');
const EDITOR_DIR = join(ROOT_DIR, 'editor');

/**
 * Recursively find all image assets
 */
async function getAllAssets(assetsDir, dir = null, basePath = '') {
  dir = dir || assetsDir;
  const assets = [];
  const extensions = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subAssets = await getAllAssets(assetsDir, fullPath, relativePath);
        assets.push(...subAssets);
      } else if (extensions.has(extname(entry.name).toLowerCase())) {
        assets.push(relativePath);
      }
    }
  } catch (error) {
    // Directory might not exist
  }

  return assets.sort();
}

/**
 * Start the Express server
 */
export async function startServer(port = 8080, options = {}) {
  const app = express();

  // Resolve assets directory
  let assetsDir = DEFAULT_ASSETS_DIR;
  if (options.assetsDir) {
    assetsDir = resolve(options.assetsDir);
  }

  // Update generator's assets directory
  setAssetsDir(assetsDir);

  console.log(`Assets directory: ${assetsDir}`);

  // Middleware
  app.use(express.json({ limit: '50mb' }));

  // Serve editor static files
  app.get('/', (_req, res) => {
    res.sendFile(join(EDITOR_DIR, 'index.html'));
  });

  app.get('/favicon.svg', (_req, res) => {
    res.sendFile(join(EDITOR_DIR, 'favicon.svg'));
  });

  // Serve assets (custom dir first, default as fallback for old templates)
  app.use('/assets', express.static(assetsDir));
  if (assetsDir !== DEFAULT_ASSETS_DIR) {
    app.use('/assets', express.static(DEFAULT_ASSETS_DIR));
  }

  // API: List all assets (merge custom + default dirs, deduplicated)
  app.get('/api/assets', async (_req, res) => {
    try {
      const assets = await getAllAssets(assetsDir);
      if (assetsDir !== DEFAULT_ASSETS_DIR) {
        const defaultAssets = await getAllAssets(DEFAULT_ASSETS_DIR);
        const merged = [...new Set([...assets, ...defaultAssets])].sort();
        return res.json(merged);
      }
      res.json(assets);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Resolve asset by filename (searches all asset dirs recursively)
  const allAssetDirs = [assetsDir];
  if (assetsDir !== DEFAULT_ASSETS_DIR) allAssetDirs.push(DEFAULT_ASSETS_DIR);

  async function findAssetByName(name, dirs) {
    for (const baseDir of dirs) {
      const found = await searchDirForFile(baseDir, name);
      if (found) return found;
    }
    return null;
  }

  async function searchDirForFile(dir, name) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await searchDirForFile(fullPath, name);
          if (found) return found;
        } else if (entry.name === name) {
          return fullPath;
        }
      }
    } catch (_e) { /* skip */ }
    return null;
  }

  app.get('/api/resolve-asset/:name', async (req, res) => {
    try {
      const filePath = await findAssetByName(req.params.name, allAssetDirs);
      if (filePath) {
        return res.sendFile(filePath);
      }
      res.status(404).json({ error: 'Asset not found' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Export thumbnail
  app.post('/api/export', async (req, res) => {
    try {
      const templateData = req.body;
      const pngBuffer = await generateThumbnail(templateData);

      res.set({
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
      });
      res.send(pngBuffer);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // API: Save template
  app.post('/api/templates/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const templatePath = join(ROOT_DIR, 'templates', `${name}.json`);
      const { writeFile, mkdir } = await import('node:fs/promises');

      await mkdir(join(ROOT_DIR, 'templates'), { recursive: true });
      await writeFile(templatePath, JSON.stringify(req.body, null, 2));

      res.json({ success: true, path: templatePath });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: List templates
  app.get('/api/templates', async (req, res) => {
    try {
      const templatesDir = join(ROOT_DIR, 'templates');
      if (!existsSync(templatesDir)) {
        return res.json([]);
      }

      const files = await readdir(templatesDir);
      const templates = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));

      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get template
  app.get('/api/templates/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const templatePath = join(ROOT_DIR, 'templates', `${name}.json`);
      const content = await readFile(templatePath, 'utf-8');
      res.json(JSON.parse(content));
    } catch (error) {
      res.status(404).json({ error: 'Template not found' });
    }
  });

  // API: Delete template
  app.delete('/api/templates/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const templatePath = join(ROOT_DIR, 'templates', `${name}.json`);
      const { unlink } = await import('node:fs/promises');
      await unlink(templatePath);
      res.json({ success: true });
    } catch (error) {
      res.status(404).json({ error: 'Template not found' });
    }
  });

  // Start server
  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🎨 Thumbnail Editor running at ${url}\n`);

    // Open browser
    import('child_process').then(({ exec }) => {
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    });
  });
}
