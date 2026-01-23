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

  // Try with common extensions
  if (!name.includes('.')) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) {
      found = await searchDir(ASSETS_DIR);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Generate HTML from template data
 */
function generateHTML(templateData) {
  const { canvas, elements } = templateData;

  let elementsHTML = '';

  for (const el of elements) {
    const style = `left: ${el.x}px; top: ${el.y}px; width: ${el.width}px; height: ${el.height}px;`;

    if (el.type === 'text') {
      const align = el.textAlign || 'left';
      const textStyle = `${style} font-size: ${el.fontSize || 48}px; font-weight: ${el.fontWeight || 700}; color: ${el.color || '#ffffff'}; font-family: ${el.fontFamily || 'Inter'};`;
      elementsHTML += `        <div class="element element-text align-${align}" style="${textStyle}">${el.content || ''}</div>\n`;
    } else if (el.type === 'image') {
      let src = el.src || '';
      if (el.assetPath) {
        const assetPath = join(ASSETS_DIR, el.assetPath);
        src = `file://${assetPath}`;
      } else if (!src.startsWith('data:') && !src.startsWith('file://')) {
        const assetPath = join(ASSETS_DIR, src);
        src = `file://${assetPath}`;
      }
      elementsHTML += `        <div class="element element-image" style="${style}"><img src="${src}"></div>\n`;
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
  const html = generateHTML(templateData);
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

  // Resolve asset paths in elements
  for (const el of templateData.elements) {
    if (el.type === 'image') {
      const assetPath = el.assetPath || el.src;
      if (assetPath && !assetPath.startsWith('data:')) {
        const found = await findAsset(assetPath);
        if (found) {
          el.src = `file://${found}`;
        } else {
          console.warn(`  Warning: Asset not found: ${assetPath}`);
        }
      }
    }
  }

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
