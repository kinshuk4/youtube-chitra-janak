#!/usr/bin/env python3
"""YouTube Thumbnail Generator - CLI and template-based generation."""

import argparse
import json
import sys
from pathlib import Path

from jinja2 import Template
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).parent
ASSETS_DIR = BASE_DIR / "assets"
TEMPLATES_DIR = BASE_DIR / "templates"
OUT_DIR = BASE_DIR / "out"


def find_asset(name: str) -> Path | None:
    """
    Find an asset by name or path.

    - If name contains '/', treat it as a relative path from assets/
    - Otherwise, search recursively for the filename
    """
    if "/" in name:
        full_path = ASSETS_DIR / name
        return full_path if full_path.exists() else None

    matches = list(ASSETS_DIR.rglob(name))

    if not matches and "." not in name:
        for ext in [".png", ".jpg", ".jpeg", ".svg", ".webp"]:
            matches = list(ASSETS_DIR.rglob(f"{name}{ext}"))
            if matches:
                break

    if not matches:
        return None

    if len(matches) > 1:
        print(f"  Warning: Multiple matches for '{name}'")
        print(f"  Using: {matches[0].relative_to(ASSETS_DIR)}")

    return matches[0]


def generate_from_template(template_path: Path, output_path: Path | None = None, overrides: dict | None = None) -> Path:
    """Generate thumbnail from a template JSON file."""
    with open(template_path) as f:
        template_data = json.load(f)

    # Apply any overrides (e.g., different title)
    if overrides:
        for el in template_data.get("elements", []):
            if el.get("type") == "text" and "title" in overrides and el.get("content"):
                # Simple heuristic: largest text is probably the title
                pass  # TODO: smarter override logic

    canvas = template_data["canvas"]
    elements = template_data["elements"]

    # Generate HTML
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
            src = el.get("src", "")
            asset_path = el.get("assetPath", src)

            # Try to find the asset
            found = find_asset(asset_path)
            if found:
                src = f"file://{found.absolute()}"
            elif not src.startswith("data:"):
                print(f"  Warning: Asset not found: {asset_path}")
                continue

            html += f'        <div class="element element-image" style="{style}"><img src="{src}"></div>\n'

        elif el["type"] == "shape":
            style += f" background: {el.get('color', '#4ecca3')};"
            style += f" border-radius: {el.get('borderRadius', '0')};"
            html += f'        <div class="element element-shape" style="{style}"></div>\n'

    html += """    </div>
</body>
</html>"""

    # Determine output path
    if output_path is None:
        output_path = OUT_DIR / f"{template_path.stem}.png"

    # Generate with Playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": canvas["width"], "height": canvas["height"]}
        )
        page.set_content(html)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(output_path), type="png")
        browser.close()

    return output_path


def main():
    parser = argparse.ArgumentParser(description="YouTube Thumbnail Generator")
    parser.add_argument("--editor", action="store_true", help="Launch visual editor")
    parser.add_argument("--template", "-t", type=str, help="Template JSON file to use")
    parser.add_argument("--output", "-o", type=str, help="Output file path")
    parser.add_argument("--port", type=int, default=8080, help="Editor server port")

    args = parser.parse_args()

    if args.editor:
        from server import run_server
        run_server(port=args.port)
        return

    if args.template:
        template_path = Path(args.template)
        if not template_path.exists():
            # Try in templates directory
            template_path = TEMPLATES_DIR / args.template
            if not template_path.exists():
                template_path = TEMPLATES_DIR / f"{args.template}.json"

        if not template_path.exists():
            print(f"Error: Template not found: {args.template}")
            sys.exit(1)

        output_path = Path(args.output) if args.output else None
        print(f"Generating from template: {template_path}")
        result = generate_from_template(template_path, output_path)
        print(f"Thumbnail saved to: {result}")
        return

    # Default: show help
    print("YouTube Thumbnail Generator")
    print()
    print("Usage:")
    print("  uv run python main.py --editor        # Launch visual editor")
    print("  uv run python main.py -t template.json  # Generate from template")
    print()
    print("Run with --help for more options")


if __name__ == "__main__":
    main()
