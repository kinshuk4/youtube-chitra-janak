#!/usr/bin/env python3
"""Development server for the thumbnail editor."""

import json
import mimetypes
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

from jinja2 import Template
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent
ASSETS_DIR = BASE_DIR / "assets"
EDITOR_DIR = BASE_DIR / "editor"
OUT_DIR = BASE_DIR / "out"


def get_all_assets() -> list[str]:
    """Recursively find all image assets."""
    extensions = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"}
    assets = []

    for path in ASSETS_DIR.rglob("*"):
        if path.is_file() and path.suffix.lower() in extensions:
            # Get relative path from assets dir
            rel_path = path.relative_to(ASSETS_DIR)
            assets.append(str(rel_path))

    return sorted(assets)


def generate_thumbnail_from_template(template_data: dict) -> bytes:
    """Generate PNG thumbnail from template data."""
    canvas = template_data["canvas"]
    elements = template_data["elements"]

    # Generate HTML for the thumbnail
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            width: {canvas['width']}px;
            height: {canvas['height']}px;
            overflow: hidden;
            font-family: 'Inter', sans-serif;
        }}
        .canvas {{
            width: 100%;
            height: 100%;
            background: {canvas['background']};
            position: relative;
        }}
        .element {{
            position: absolute;
        }}
        .element-text {{
            white-space: pre-wrap;
            word-break: break-word;
        }}
        .element-image img {{
            width: 100%;
            height: 100%;
            object-fit: contain;
        }}
    </style>
</head>
<body>
    <div class="canvas">
"""

    for el in elements:
        style = f"left: {el['x']}px; top: {el['y']}px; width: {el['width']}px; height: {el['height']}px;"

        if el["type"] == "text":
            style += f" font-size: {el.get('fontSize', 48)}px;"
            style += f" font-weight: {el.get('fontWeight', 700)};"
            style += f" color: {el.get('color', '#ffffff')};"
            style += f" font-family: {el.get('fontFamily', 'Inter')};"
            content = el.get("content", "")
            html += f'        <div class="element element-text" style="{style}">{content}</div>\n'

        elif el["type"] == "image":
            # Resolve asset path
            src = el.get("src", "")
            if el.get("assetPath"):
                src = f"file://{(ASSETS_DIR / el['assetPath']).absolute()}"
            elif not src.startswith("data:") and not src.startswith("file://"):
                src = f"file://{(ASSETS_DIR / src).absolute()}"
            html += f'        <div class="element element-image" style="{style}"><img src="{src}"></div>\n'

        elif el["type"] == "shape":
            style += f" background: {el.get('color', '#4ecca3')};"
            style += f" border-radius: {el.get('borderRadius', '0')};"
            html += f'        <div class="element element-shape" style="{style}"></div>\n'

    html += """    </div>
</body>
</html>"""

    # Generate screenshot with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": canvas["width"], "height": canvas["height"]}
        )
        page.set_content(html)
        page.wait_for_load_state("networkidle")
        screenshot = page.screenshot(type="png")
        browser.close()

    return screenshot


class EditorHandler(SimpleHTTPRequestHandler):
    """HTTP request handler for the editor."""

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Serve editor
        if path == "/" or path == "/index.html":
            self.serve_file(EDITOR_DIR / "index.html", "text/html")
            return

        # Serve assets
        if path.startswith("/assets/"):
            asset_path = ASSETS_DIR / path[8:]  # Remove '/assets/'
            if asset_path.exists() and asset_path.is_file():
                mime_type = mimetypes.guess_type(str(asset_path))[0] or "application/octet-stream"
                self.serve_file(asset_path, mime_type)
                return
            self.send_error(404, "Asset not found")
            return

        # API: List assets
        if path == "/api/assets":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(get_all_assets()).encode())
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Export thumbnail
        if path == "/api/export":
            content_length = int(self.headers["Content-Length"])
            body = self.rfile.read(content_length)
            template_data = json.loads(body)

            try:
                png_data = generate_thumbnail_from_template(template_data)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", len(png_data))
                self.end_headers()
                self.wfile.write(png_data)
            except Exception as e:
                self.send_error(500, str(e))
            return

        self.send_error(404, "Not found")

    def serve_file(self, path: Path, content_type: str):
        """Serve a file with the given content type."""
        try:
            with open(path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, format, *args):
        """Suppress logging for cleaner output."""
        pass


def run_server(port: int = 8080):
    """Run the development server."""
    server = HTTPServer(("localhost", port), EditorHandler)
    url = f"http://localhost:{port}"
    print(f"Starting thumbnail editor at {url}")
    print("Press Ctrl+C to stop\n")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
        server.shutdown()


if __name__ == "__main__":
    run_server()
