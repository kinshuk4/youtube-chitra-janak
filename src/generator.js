/**
 * Thumbnail generation using Playwright
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const ASSETS_DIR = join(ROOT_DIR, 'assets');
const TEMPLATES_DIR = join(ROOT_DIR, 'templates');
const OUT_DIR = join(ROOT_DIR, 'out');

/**
 * Find an asset by name or path
 */
async function findAsset(name) {
  // If it's a path, use directly
  if (name.includes('/')) {
    const fullPath = join(ASSETS_DIR, name);
    return existsSync(fullPath) ? fullPath : null;
  }

  // Search recursively
  async function searchDir(dir) {
    const { readdir } = await import('node:fs/promises');
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await searchDir(fullPath);
          if (found) return found;
        } else if (entry.name === name) {
          return fullPath;
        }
      }
    } catch (e) {
      // Directory doesn't exist
    }
    return null;
  }

  // Try exact match first
  let found = await searchDir(ASSETS_DIR);
  if (found) return found;

  // Try with common extensions if no extension provided
  if (!name.includes('.')) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
      const nameWithExt = name + ext;
      async function searchWithExt(dir) {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              const found = await searchWithExt(fullPath);
              if (found) return found;
            } else if (entry.name === nameWithExt) {
              return fullPath;
            }
          }
        } catch (e) {}
        return null;
      }
      found = await searchWithExt(ASSETS_DIR);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get mime type from file extension
 */
function getMimeType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeTypes = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
  };
  return mimeTypes[ext] || 'image/png';
}

/**
 * Convert a file to base64 data URL
 */
async function fileToDataURL(filePath) {
  try {
    const data = await readFile(filePath);
    const mimeType = getMimeType(filePath);
    const base64 = data.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (e) {
    console.warn(`  Warning: Could not read file: ${filePath}`);
    return null;
  }
}

/**
 * Resolve image source to a data URL or keep as-is if already data URL
 */
async function resolveImageSrc(el) {
  let src = el.src || '';

  // Already a data URL - keep as is
  if (src.startsWith('data:')) {
    return src;
  }

  // Determine the file path
  let filePath = null;

  if (el.assetPath) {
    filePath = join(ASSETS_DIR, el.assetPath);
  } else if (src.startsWith('/assets/')) {
    const relativePath = src.replace('/assets/', '');
    filePath = join(ASSETS_DIR, relativePath);
  } else if (src.startsWith('file://')) {
    filePath = src.replace('file://', '');
  } else if (src) {
    filePath = join(ASSETS_DIR, src);
  }

  if (filePath && existsSync(filePath)) {
    return await fileToDataURL(filePath);
  }

  console.warn(`  Warning: Asset not found: ${el.assetPath || src}`);
  return null;
}

/**
 * Generate HTML from template data
 */
async function generateHTML(templateData) {
  const { canvas, elements } = templateData;

  let elementsHTML = '';

  for (const el of elements) {
    const style = `left: ${el.x}px; top: ${el.y}px; width: ${el.width}px; height: ${el.height}px;`;

    if (el.type === 'text') {
      const align = el.textAlign || 'left';
      const textStyle = `${style} font-size: ${el.fontSize || 48}px; font-weight: ${el.fontWeight || 700}; color: ${el.color || '#ffffff'}; font-family: ${el.fontFamily || 'Inter'};`;
      elementsHTML += `        <div class="element element-text align-${align}" style="${textStyle}">${el.content || ''}</div>\n`;
    } else if (el.type === 'image') {
      const src = await resolveImageSrc(el);
      if (src) {
        elementsHTML += `        <div class="element element-image" style="${style}"><img src="${src}"></div>\n`;
      }
    } else if (el.type === 'shape') {
      const shapeStyle = `${style} background: ${el.color || '#4ecca3'}; border-radius: ${el.borderRadius || '0'};`;
      elementsHTML += `        <div class="element element-shape" style="${shapeStyle}"></div>\n`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            width: ${canvas.width}px;
            height: ${canvas.height}px;
            overflow: hidden;
            font-family: 'Inter', sans-serif;
        }
        .canvas {
            width: 100%;
            height: 100%;
            background: ${canvas.background};
            position: relative;
        }
        .element {
            position: absolute;
        }
        .element-text {
            white-space: pre-wrap;
            word-break: break-word;
            display: flex;
            align-items: center;
        }
        .element-text.align-left { justify-content: flex-start; text-align: left; }
        .element-text.align-center { justify-content: center; text-align: center; }
        .element-text.align-right { justify-content: flex-end; text-align: right; }
        .element-image img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
    </style>
</head>
<body>
    <div class="canvas">
${elementsHTML}    </div>
</body>
</html>`;
}

/**
 * Generate thumbnail from template data (returns PNG buffer)
 */
export async function generateThumbnail(templateData) {
  const html = await generateHTML(templateData);
  const { canvas } = templateData;

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: canvas.width, height: canvas.height },
  });

  await page.setContent(html);
  await page.waitForLoadState('networkidle');

  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();

  return screenshot;
}

/**
 * Generate thumbnail from a template file
 */
export async function generateFromTemplate(templatePath, outputPath) {
  // Resolve template path
  let fullTemplatePath = templatePath;

  if (!existsSync(fullTemplatePath)) {
    fullTemplatePath = join(TEMPLATES_DIR, templatePath);
  }
  if (!existsSync(fullTemplatePath)) {
    fullTemplatePath = join(TEMPLATES_DIR, `${templatePath}.json`);
  }
  if (!existsSync(fullTemplatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  console.log(`Loading template: ${fullTemplatePath}`);

  const content = await readFile(fullTemplatePath, 'utf-8');
  const templateData = JSON.parse(content);

  // generateHTML will handle resolving image paths to base64
  const pngBuffer = await generateThumbnail(templateData);

  // Determine output path
  if (!outputPath) {
    await mkdir(OUT_DIR, { recursive: true });
    const templateName = basename(fullTemplatePath, '.json');
    outputPath = join(OUT_DIR, `${templateName}.png`);
  }

  await writeFile(outputPath, pngBuffer);
  return outputPath;
}
