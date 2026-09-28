import io
import json
import re
from urllib.parse import unquote, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

MAX_PAGES = 30
MAX_PAGE_CHARS = 5000
MAX_TOTAL_CHARS = 90000
PRODUCT_HINTS = (
    "product",
    "shop",
    "store",
    "collection",
    "category",
    "protein",
    "supplement",
    "preworkout",
    "whey",
    "contact",
    "support",
    "about",
    "help",
)
CONTACT_PATHS = (
    "/pages/contact",
    "/pages/contact-us",
    "/contact",
    "/contact-us",
    "/pages/support",
    "/pages/about",
)
SKIP_EXT = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".css",
    ".js",
    ".zip",
    ".mp4",
    ".mp3",
}


def normalize_website(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if not value.startswith(("http://", "https://")):
        value = "https://" + value
    parsed = urlparse(value)
    if not parsed.netloc:
        return ""
    return value


def _add_image(urls: list[str], src: object) -> None:
    value = str(src or "").strip()
    if value.startswith(("http://", "https://")) and value not in urls:
        urls.append(value[:800])


def storefront_images(item: dict, variant: dict) -> list[str]:
    urls: list[str] = []
    featured = variant.get("featured_image")
    if isinstance(featured, dict):
        _add_image(urls, featured.get("src"))
    images = [image for image in (item.get("images") or []) if isinstance(image, dict)]
    variant_id = variant.get("id")
    for image in images:
        if variant_id and variant_id in (image.get("variant_ids") or []):
            _add_image(urls, image.get("src"))
    for image in images:
        _add_image(urls, image.get("src"))
    return urls


def storefront_image(item: dict, variant: dict) -> str:
    images = storefront_images(item, variant)
    return images[0] if images else ""


def same_site(seed_host: str, link_host: str) -> bool:
    return seed_host.removeprefix("www.") == link_host.removeprefix("www.")


def fetch_storefront_catalog(raw_url: str) -> list[dict]:
    start = normalize_website(raw_url)
    if not start:
        return []

    parsed = urlparse(start)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    products: list[dict] = []

    with httpx.Client(
        follow_redirects=True,
        timeout=20,
        headers={"User-Agent": "AibotKnowledgeBot/1.0"},
    ) as client:
        for page in range(1, 21):
            try:
                response = client.get(f"{origin}/products.json", params={"limit": 250, "page": page})
            except Exception:
                break
            if response.status_code >= 400:
                break
            try:
                batch = (response.json() or {}).get("products") or []
            except Exception:
                break
            if not batch:
                break
            for item in batch:
                name = str(item.get("title") or "").strip()
                if not name:
                    continue
                handle = str(item.get("handle") or "").strip()
                source = f"{origin}/products/{handle}" if handle else origin
                variants = item.get("variants") or [{}]
                for variant in variants:
                    if not isinstance(variant, dict):
                        continue
                    variant_name = str(variant.get("title") or "").strip()
                    if variant_name.lower() in {"", "default title"}:
                        variant_name = ""
                    tags = item.get("tags") or []
                    tag_text = " ".join(tags) if isinstance(tags, list) else str(tags)
                    available = variant.get("available")
                    if COMING_RE.search(f"{name} {variant_name} {tag_text}"):
                        stock = "coming_soon"
                    elif available is True:
                        stock = "in_stock"
                    elif available is False:
                        stock = "out_of_stock"
                    else:
                        stock = "unknown"
                    sku = str(variant.get("sku") or "").strip()
                    barcode = str(variant.get("barcode") or "").strip()
                    category = str(item.get("product_type") or "").strip()
                    if not category and isinstance(tags, list) and tags:
                        category = str(tags[0]).strip()
                    vendor = str(item.get("vendor") or "").strip()
                    extras = {}
                    if vendor:
                        extras["brand"] = vendor[:120]
                    external_id = sku or str(variant.get("id") or handle or name)
                    images = storefront_images(item, variant)
                    products.append(
                        {
                            "external_id": external_id[:120],
                            "name": name[:300],
                            "variant": variant_name[:200],
                            "price": str(variant.get("price") or "")[:80],
                            "stock_status": stock,
                            "source_url": source[:500],
                            "image_url": images[0] if images else "",
                            "image_urls": images,
                            "category": category[:200],
                            "item_number": sku[:120],
                            "batch_number": barcode[:120],
                            "extras": extras,
                        }
                    )
            if len(batch) < 250:
                break

    return products


def clean_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return text.strip()


STOCK_RE = re.compile(
    r"sold\s*out|out\s*of\s*stock|unavailable|notify\s*me|coming\s*soon",
    re.IGNORECASE,
)
COMING_RE = re.compile(
    r"coming\s*soon|pre-?order|upcoming|launching\s*soon",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
PHONE_RE = re.compile(
    r"(?:\+92|0)\s*\d{2,3}(?:[\s-]*\d{3}){2,3}",
)


def extract_catalog_hints(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    lines: list[str] = []

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or ""
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        blocks = payload if isinstance(payload, list) else [payload]
        for block in blocks:
            if not isinstance(block, dict):
                continue
            types = block.get("@type")
            type_name = " ".join(types) if isinstance(types, list) else str(types or "")
            if "product" not in type_name.lower():
                continue
            name = block.get("name") or ""
            offers = block.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            availability = str(offers.get("availability") or "")
            price = offers.get("price") or ""
            stock = (
                "out_of_stock"
                if re.search(r"OutOfStock|sold", availability, re.I)
                else "in_stock"
            )
            lines.append(f"PRODUCT: {name} | price {price} | stock_hint={stock}")

    selectors = (
        '[class*="product-card"]',
        '[class*="product-item"]',
        '[class*="grid-product"]',
        '[class*="product-block"]',
        '[data-product-id]',
        'li[class*="product"]',
    )
    for selector in selectors:
        for card in soup.select(selector):
            text = re.sub(r"\s+", " ", card.get_text(" ", strip=True))
            if len(text) < 8:
                continue
            classes = " ".join(card.get("class") or [])
            stock = (
                "out_of_stock"
                if STOCK_RE.search(text) or STOCK_RE.search(classes)
                else "listed"
            )
            lines.append(f"PRODUCT: {text[:420]} | stock_hint={stock}")

    unique: list[str] = []
    seen: set[str] = set()
    for line in lines:
        key = line[:160].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(line)
    return "\n".join(unique[:120])


def extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    text = re.sub(r"\s+", " ", "\n".join(pages)).strip()
    return text[:MAX_TOTAL_CHARS]


def scrape_website(raw_url: str) -> tuple[str, list[dict]]:
    start = normalize_website(raw_url)
    if not start:
        return "", []

    seed = urlparse(start)
    origin = f"{seed.scheme}://{seed.netloc}"
    queued = [start]
    for path in CONTACT_PATHS:
        queued.append(f"{origin}{path}")
    seen: set[str] = set()
    pages: list[dict] = []

    with httpx.Client(
        follow_redirects=True,
        timeout=12,
        headers={"User-Agent": "AibotKnowledgeBot/1.0"},
    ) as client:
        while queued and len(pages) < MAX_PAGES:
            queued.sort(key=lambda url: 0 if any(hint in url.lower() for hint in PRODUCT_HINTS) else 1)
            current = queued.pop(0)
            parsed = urlparse(current)
            path = parsed.path.lower()
            if current in seen or any(path.endswith(ext) for ext in SKIP_EXT):
                continue
            if not same_site(seed.netloc, parsed.netloc):
                continue
            seen.add(current)

            try:
                response = client.get(current)
            except Exception:
                continue
            content_type = response.headers.get("content-type", "")
            if response.status_code >= 400 or "text/html" not in content_type:
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            title = (soup.title.string or "").strip() if soup.title else parsed.path
            text = clean_html_text(response.text)[:MAX_PAGE_CHARS]
            hints = extract_catalog_hints(response.text)
            if hints:
                text = f"{text}\n\nCATALOG HINTS:\n{hints}"
            if text:
                pages.append({"url": str(response.url), "title": title, "text": text})

            for anchor in soup.find_all("a", href=True):
                href = urljoin(current, anchor["href"])
                link = urlparse(href)
                clean = f"{link.scheme}://{link.netloc}{link.path}"
                if (
                    link.scheme in {"http", "https"}
                    and same_site(seed.netloc, link.netloc)
                    and clean not in seen
                    and clean not in queued
                ):
                    queued.append(clean)

    combined = []
    used = 0
    for page in pages:
        chunk = f"Page: {page['title']}\nURL: {page['url']}\n{page['text']}"
        if used + len(chunk) > MAX_TOTAL_CHARS:
            break
        combined.append(chunk)
        used += len(chunk)

    return "\n\n".join(combined), [{"url": page["url"], "title": page["title"]} for page in pages]


def rebuild_knowledge(
    description: str,
    pdf_name: str,
    pdf_text: str,
    website_url: str,
    website_text: str,
) -> str:
    parts = []
    if description.strip():
        parts.append(f"Business description:\n{description.strip()}")
    if pdf_text.strip():
        label = pdf_name.strip() or "uploaded PDF"
        parts.append(f"PDF ({label}):\n{pdf_text.strip()}")
    if website_text.strip():
        parts.append(f"Website {website_url.strip()}:\n{website_text.strip()}")
    return "\n\n".join(parts)


def pages_json(pages: list[dict]) -> str:
    return json.dumps(pages)


def _looks_like_phone(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if not (10 <= len(digits) <= 15):
        return False
    return digits.startswith(("0", "92", "3")) or value.strip().startswith("+")


def extract_contacts(text: str) -> dict[str, str]:
    emails = [
        item.lower()
        for item in EMAIL_RE.findall(text or "")
        if not item.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".svg"))
    ]
    phones = [item.strip() for item in PHONE_RE.findall(text or "") if _looks_like_phone(item)]
    return {
        "email": emails[0] if emails else "",
        "phone": phones[0] if phones else "",
    }


def extract_contacts_from_html(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    emails: list[str] = []
    phones: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "")
        if href.lower().startswith("mailto:"):
            address = unquote(href.split(":", 1)[-1].split("?", 1)[0]).strip()
            if address and address not in emails:
                emails.append(address)
        if href.lower().startswith("tel:"):
            number = unquote(href.split(":", 1)[-1]).strip()
            if _looks_like_phone(number) and number not in phones:
                phones.append(number)
    text_contacts = extract_contacts(clean_html_text(html))
    return {
        "email": emails[0] if emails else text_contacts["email"],
        "phone": phones[0] if phones else text_contacts["phone"],
    }


def _name_needles(name: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", name).strip().lower()
    if not cleaned:
        return []
    needles = [cleaned]
    short = re.split(r"\s+[–—|-]\s+", cleaned, maxsplit=1)[0].strip()
    if short and short != cleaned:
        needles.append(short)
    return needles


CATALOG_STORE_LIMIT = 200
CATALOG_CHAT_LIMIT = 40
SEARCH_STOP = {
    "the",
    "and",
    "for",
    "you",
    "your",
    "are",
    "is",
    "this",
    "that",
    "have",
    "has",
    "how",
    "much",
    "many",
    "too",
    "there",
    "what",
    "when",
    "why",
    "with",
    "from",
    "please",
    "can",
    "do",
    "does",
    "any",
    "some",
    "item",
    "items",
    "product",
    "products",
    "stock",
    "sold",
    "out",
    "available",
    "about",
    "tell",
    "give",
    "list",
    "show",
    "kitna",
    "kitne",
    "kitni",
    "kitny",
    "hain",
    "hai",
}


def catalog_inventory_stats(products: list) -> dict[str, int]:
    in_stock = sum(1 for item in products if getattr(item, "stock_status", "") == "in_stock")
    sold_out = sum(1 for item in products if getattr(item, "stock_status", "") == "out_of_stock")
    upcoming = sum(1 for item in products if getattr(item, "stock_status", "") == "coming_soon")
    return {
        "total": len(products),
        "in_stock": in_stock,
        "sold_out": sold_out,
        "upcoming": upcoming,
    }


def format_catalog_snapshot(products: list) -> str:
    stats = catalog_inventory_stats(products)
    if not stats["total"]:
        return "Catalog snapshot: no products are synced yet."
    categories: dict[str, int] = {}
    for item in products:
        category = (getattr(item, "category", "") or "").strip()
        if category:
            categories[category] = categories.get(category, 0) + 1
    top = sorted(categories.items(), key=lambda pair: pair[1], reverse=True)[:12]
    lines = [
        "Catalog snapshot (exact live counts — use these for how-many questions):",
        f"- Total products: {stats['total']}",
        f"- In stock: {stats['in_stock']}",
        f"- Out of stock / sold out: {stats['sold_out']}",
        f"- Upcoming: {stats['upcoming']}",
    ]
    if top:
        lines.append(
            "- Top categories: " + ", ".join(f"{name} ({count})" for name, count in top)
        )
    lines.append(
        "These counts are official. Answer how-many-products questions from this snapshot. Do not escalate them."
    )
    return "\n".join(lines)


def format_catalog_lines(products: list, heading: str = "Product catalog:") -> str:
    if not products:
        return ""
    lines = [heading]
    for item in products:
        variant = f" ({item.variant})" if getattr(item, "variant", "") else ""
        category = f" | category {item.category}" if getattr(item, "category", "") else ""
        item_no = f" | item {item.item_number}" if getattr(item, "item_number", "") else ""
        batch = f" | batch {item.batch_number}" if getattr(item, "batch_number", "") else ""
        lines.append(
            f"- ID {getattr(item, 'external_id', '')}: {item.name}{variant}{category}{item_no}{batch} | price {getattr(item, 'price', '') or 'n/a'} | {getattr(item, 'stock_status', 'unknown')}"
        )
    return "\n".join(lines)


def search_catalog(products: list, question: str, limit: int = CATALOG_CHAT_LIMIT) -> list:
    tokens = [
        token
        for token in re.findall(r"[a-z0-9]{3,}", (question or "").lower())
        if token not in SEARCH_STOP
    ]
    if not tokens:
        return []
    scored: list[tuple[int, object]] = []
    for product in products:
        blob = " ".join(
            [
                getattr(product, "name", "") or "",
                getattr(product, "variant", "") or "",
                getattr(product, "category", "") or "",
                getattr(product, "external_id", "") or "",
                getattr(product, "item_number", "") or "",
            ]
        ).lower()
        score = sum(token in blob for token in tokens)
        if score:
            scored.append((score, product))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [product for _score, product in scored[:limit]]


def match_product_cards(products: list, question: str, answer: str, history: list[dict] | None = None, limit: int = 3) -> list:
    recent = " ".join(item.get("text") or "" for item in (history or [])[-4:])
    haystack = f"{recent}\n{question}\n{answer}".lower()
    scored: list[tuple[int, object]] = []
    for product in products:
        image = (getattr(product, "image_url", "") or "").strip()
        extra_images = getattr(product, "image_urls", "") or ""
        has_image = image.startswith(("http://", "https://", "/uploads/")) or "/uploads/" in extra_images
        if not has_image:
            continue
        names = _name_needles(getattr(product, "name", "") or "")
        variant = (getattr(product, "variant", "") or "").strip().lower()
        external_id = (getattr(product, "external_id", "") or "").strip().lower()
        score = 0
        for name in names:
            if len(name) >= 4 and name in haystack:
                score = max(score, len(name))
        if external_id and len(external_id) >= 4 and external_id in haystack:
            score = max(score, len(external_id))
        if score and variant and len(variant) >= 4 and variant in haystack:
            score += len(variant)
        if score:
            scored.append((score, product))
    scored.sort(key=lambda item: item[0], reverse=True)
    cards = []
    seen: set[tuple[str, str]] = set()
    for _score, product in scored:
        key = (
            (getattr(product, "name", "") or "").lower(),
            (getattr(product, "variant", "") or "").lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        cards.append(product)
        if len(cards) >= limit:
            break
    return cards
