#!/usr/bin/env node
/**
 * YouTube Thumbnail Generator
 * Main entry point - handles CLI and server
 */

import { parseArgs } from 'node:util';
import { startServer } from './server.js';
import { generateFromTemplate } from './generator.js';

const options = {
  editor: { type: 'boolean', default: false },
  template: { type: 'string', short: 't' },
  output: { type: 'string', short: 'o' },
  port: { type: 'string', default: '8080' },
  'assets-dir': { type: 'string', short: 'a' },
  help: { type: 'boolean', short: 'h' },
};

function showHelp() {
  console.log(`
YouTube Thumbnail Generator (Chitra)

Usage:
  npm run editor              Launch visual editor
  npm run dev                 Launch editor with hot reload
  npm start -- -t template.json  Generate from template

Options:
  --editor            Launch the visual editor in browser
  --template, -t      Template JSON file to generate from
  --output, -o        Output file path (default: out/<template-name>.png)
  --port              Server port (default: 8080)
  --assets-dir, -a    Custom assets directory (default: ./assets)
  --help, -h          Show this help message

Examples:
  npm run editor
  npm run editor -- --assets-dir ~/projects/transcripts
  npm start -- -t templates/leetcode.json
  npm start -- -t leetcode.json -o out/my-thumbnail.png -a /path/to/images
`);
}

async function main() {
  const { values } = parseArgs({ options, allowPositionals: true });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  // Resolve assets directory (can be absolute or relative)
  const assetsDir = values['assets-dir'] || null;

  if (values.editor || (!values.template && !values.help)) {
    // Default to editor mode
    const port = parseInt(values.port) || 8080;
    await startServer(port, { assetsDir });
    return;
  }

  if (values.template) {
    try {
      const outputPath = await generateFromTemplate(values.template, values.output, { assetsDir });
      console.log(`Thumbnail saved to: ${outputPath}`);
    } catch (error) {
      console.error('Error generating thumbnail:', error.message);
      process.exit(1);
    }
    return;
  }

  showHelp();
}

main().catch(console.error);
