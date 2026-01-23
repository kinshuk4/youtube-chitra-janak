#!/usr/bin/env python3
"""YouTube Thumbnail Generator using Playwright + HTML/CSS."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml
from jinja2 import Environment, FileSystemLoader
from playwright.sync_api import sync_playwright


@dataclass
class StyleConfig:
    """Styling configuration for the thumbnail."""

    background_color: str = "#1a1a2e"
    title_color: str = "#ffffff"
    subtitle_color: str = "#e0e0e0"
    accent_color: str = "#4ecca3"


@dataclass
class GridConfig:
    """Grid layout configuration."""

    rows: int = 1
    cols: int = 3


@dataclass
class OutputConfig:
    """Output settings."""

    width: int = 1280
    height: int = 720
    filename: str = "thumbnail.png"


@dataclass
class ThumbnailConfig:
    """Main configuration for thumbnail generation."""

    # Output settings
    output: OutputConfig = field(default_factory=OutputConfig)

    # Grid layout
    grid: GridConfig = field(default_factory=GridConfig)

    # Text content
    title: Optional[str] = None
    subtitle: Optional[str] = None

    # Styling
    style: StyleConfig = field(default_factory=StyleConfig)

    # Difficulty: easy, medium, hard
    difficulty: Optional[str] = None

    # Avatar/face image path (relative to assets/)
    avatar: Optional[str] = None

    # Show avatar as large image on right side
    show_large_avatar: bool = True

    # Brand/channel logo path (relative to assets/)
    brand_logo: Optional[str] = None

    # Author name
    author_name: Optional[str] = None

    # Concept images (relative to assets/)
    concepts: list[str] = field(default_factory=list)

    # Tech/language logo (relative to assets/)
    tech_logo: Optional[str] = None


def load_config_from_yaml(config_path: Path) -> ThumbnailConfig:
    """Load configuration from YAML file."""
    with open(config_path) as f:
        data = yaml.safe_load(f)

    config = ThumbnailConfig()

    if "output" in data:
        config.output = OutputConfig(**data["output"])

    if "grid" in data:
        config.grid = GridConfig(**data["grid"])

    if "style" in data:
        config.style = StyleConfig(**data["style"])

    # Simple fields
    for field_name in [
        "title",
        "subtitle",
        "difficulty",
        "avatar",
        "brand_logo",
        "author_name",
        "concepts",
        "tech_logo",
        "show_large_avatar",
    ]:
        if field_name in data:
            setattr(config, field_name, data[field_name])

    return config


def find_asset(name: str, assets_dir: Path) -> Optional[Path]:
    """
    Find an asset by name or path.

    - If name contains '/', treat it as a relative path from assets/
    - Otherwise, search recursively for the filename
    - If multiple matches found, warn and use first match
    """
    # If it looks like a path, use it directly
    if "/" in name:
        full_path = assets_dir / name
        return full_path if full_path.exists() else None

    # Search recursively for the filename
    matches = list(assets_dir.rglob(name))

    # Also try common extensions if no extension provided
    if not matches and "." not in name:
        for ext in [".png", ".jpg", ".jpeg", ".svg", ".webp"]:
            matches = list(assets_dir.rglob(f"{name}{ext}"))
            if matches:
                break

    if not matches:
        return None

    if len(matches) > 1:
        print(f"  Warning: Multiple matches for '{name}': {[str(m.relative_to(assets_dir)) for m in matches]}")
        print(f"  Using: {matches[0].relative_to(assets_dir)}")
        print(f"  Tip: Use full path to resolve ambiguity")

    return matches[0]


def resolve_asset_path(asset_path: Optional[str], base_dir: Path) -> Optional[str]:
    """Convert asset name/path to absolute file:// URL."""
    if asset_path is None:
        return None

    assets_dir = base_dir / "assets"
    found = find_asset(asset_path, assets_dir)

    if found:
        return f"file://{found.absolute()}"

    return None


def generate_thumbnail(config: ThumbnailConfig, base_dir: Path) -> Path:
    """Generate thumbnail image from configuration."""
    # Set up Jinja2 environment
    template_dir = base_dir / "templates"
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("thumbnail.html")

    # Resolve asset paths to absolute file:// URLs
    avatar_url = resolve_asset_path(config.avatar, base_dir)
    brand_logo_url = resolve_asset_path(config.brand_logo, base_dir)
    tech_logo_url = resolve_asset_path(config.tech_logo, base_dir)

    concept_urls = []
    for concept_path in config.concepts:
        url = resolve_asset_path(concept_path, base_dir)
        if url:
            concept_urls.append(url)

    # Render HTML template
    html_content = template.render(
        width=config.output.width,
        height=config.output.height,
        grid=config.grid,
        style=config.style,
        title=config.title,
        subtitle=config.subtitle,
        difficulty=config.difficulty,
        avatar=avatar_url,
        show_large_avatar=config.show_large_avatar,
        brand_logo=brand_logo_url,
        author_name=config.author_name,
        concepts=concept_urls,
        tech_logo=tech_logo_url,
    )

    # Generate image using Playwright
    output_path = base_dir / "out" / config.output.filename

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": config.output.width, "height": config.output.height}
        )

        # Set content and wait for fonts to load
        page.set_content(html_content)
        page.wait_for_load_state("networkidle")

        # Take screenshot
        page.screenshot(path=str(output_path), type="png")
        browser.close()

    return output_path


def main():
    """Main entry point."""
    base_dir = Path(__file__).parent

    # You can either load from YAML or define config inline
    config_path = base_dir / "config.yaml"

    if config_path.exists():
        print(f"Loading configuration from {config_path}")
        config = load_config_from_yaml(config_path)
    else:
        # Example inline configuration
        config = ThumbnailConfig(
            title="HashMap Deep Dive",
            subtitle="Everything you need to know",
            difficulty="medium",
            author_name="Your Name",
            grid=GridConfig(rows=1, cols=2),
            concepts=[
                "concepts/algo/hashmap.png",
                "concepts/algo/collision.png",
            ],
        )

    print(f"Generating thumbnail: {config.title or 'Untitled'}")
    print(f"Grid: {config.grid.rows}x{config.grid.cols}")
    print(f"Output: {config.output.width}x{config.output.height}")

    output_path = generate_thumbnail(config, base_dir)
    print(f"Thumbnail saved to: {output_path}")


if __name__ == "__main__":
    main()
