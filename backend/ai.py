import base64
import json
import os
import re

import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODELS = [
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
]
GEMINI_IMAGE_MODELS = [
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-lite-image",
]
TRY_ON_RE = re.compile(
    r"(try\s*on|virtual try|laga\s*do|laga\s*dou|pehna|mujh\s*pe|mere\s*up[ae]r|wear this|on me|fitting)",
    re.IGNORECASE,
)

ESCALATE_MARKER = "[[ESCALATE]]"
HUMAN_REQUEST = re.compile(
    r"\b(human|agent|person|staff|insaan|representative)\b",
    re.IGNORECASE,
)
INVENTORY_COUNT_RE = re.compile(
    r"("
    r"how\s+(much|many)\s+.*\b(product|item|sku|inventor)"
    r"|(total|kitn[aeiy]+)\s+.*\b(product|item|sku)"
    r"|\b(product|item)s?\s+(do\s+you\s+have|hain|kitn)"
    r"|catalog\s+(size|count)"
    r"|kitn[aeiy]+\s+(product|item)"
    r")",
    re.IGNORECASE,
)
STOCK_REASON_RE = re.compile(
    r"(out of stock|sold out|stock|short|unavailable|restock|inventory)",
    re.IGNORECASE,
)
STOCK_WHY_RE = re.compile(
    r"(why|kyn|kyun|waja|wajah|reason|cause|too many|too much|itn[aei]|kitn[aei]|"
    r"kab |when (will|is|are|do)|restock|back in stock|kb )",
    re.IGNORECASE,
)


def is_inventory_count_question(question: str) -> bool:
    return bool(INVENTORY_COUNT_RE.search(question or ""))


def needs_owner_review(question: str) -> bool:
    text = question or ""
    if is_inventory_count_question(text):
        return False
    return bool(STOCK_REASON_RE.search(text) and STOCK_WHY_RE.search(text))


def should_escalate(question: str, answer: str) -> bool:
    return (
        bool(HUMAN_REQUEST.search(question))
        or ESCALATE_MARKER in answer
        or needs_owner_review(question)
    )


def clean_answer(answer: str) -> str:
    return answer.replace(ESCALATE_MARKER, "").strip()


def build_prompt(company_name: str, knowledge_text: str, history: list[dict], question: str) -> str:
    history_lines = []
    for item in history[-8:]:
        history_lines.append(f"{item['sender']}: {item['text']}")
    transcript = "\n".join(history_lines) or "No previous messages."
    knowledge = knowledge_text.strip() or "No extra company knowledge was provided."

    return f"""You are the customer support assistant for {company_name}.
Answer clearly and briefly. Use the company knowledge and product catalog when it helps.
When you mention a product, use its exact catalog name so its photo can be shown.
If a customer asks how many products you have, or how many are in stock / sold out, answer from the Catalog snapshot counts. Those numbers are exact. Do not add {ESCALATE_MARKER}.
If a customer asks whether a named product, size, or flavor is available, answer from the matching product lines only.
If the catalog marks a product out_of_stock, say it is out of stock. Do not hide those products.
If the product is missing from the catalog, say you cannot confirm it and add {ESCALATE_MARKER}.
The catalog does not explain WHY items are out of stock or when they will restock. Do not invent popularity, demand, or supplier reasons. Give a short honest reply and add {ESCALATE_MARKER}.
If you cannot answer confidently, or the customer wants a human, still give a short helpful reply and add {ESCALATE_MARKER} at the end.
Never invent a phone number or email. Support contacts are applied automatically when you cannot answer.
If Learned Q&A matches this question, use that answer.
If the customer is rude or abusive, stay calm and respectful. Do not match their tone. Ask them to continue politely.
If the question is out of context for this business, say so politely and steer them back to products or support.

Company knowledge:
{knowledge}

Recent chat:
{transcript}

Customer question:
{question}
"""


def extract_products_from_text(source_text: str) -> list[dict]:
    if not source_text.strip():
        return []
    prompt = f"""Extract EVERY product from this business website/PDF text.
Include sold out, out of stock, unavailable, notify me, and coming soon items. Never skip a product because it is out of stock.
If CATALOG HINTS say stock_hint=out_of_stock, or the text says Sold out / Out of stock, set stock to out_of_stock.
If the product is listed without a sold-out label, set stock to in_stock.
Return every size/flavor variant as its own item when possible.
Return ONLY a JSON array. No markdown. Each item must have:
id (short sku or slug), name, variant (size/flavor or empty), category (collection/type or empty),
item_number (sku/item code or empty), batch_number (batch/lot/barcode or empty),
price, stock (in_stock, out_of_stock, or coming_soon), url (if any), image (image url if any),
extras (object of extra business fields, or empty object).
If no products exist, return [].

Text:
{source_text[:70000]}
"""
    raw = ask_gemini(prompt, timeout=90)
    return parse_product_json(raw)


def parse_product_json(raw: str) -> list[dict]:
    cleaned = raw.replace(ESCALATE_MARKER, "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        items = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return []
    products = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        stock = str(item.get("stock") or item.get("stock_status") or "unknown").lower()
        if any(word in stock for word in ("coming", "preorder", "upcoming")):
            stock = "coming_soon"
        elif any(word in stock for word in ("out", "sold", "unavail", "notify")):
            stock = "out_of_stock"
        elif "in" in stock or stock in {"available", "yes", "listed"}:
            stock = "in_stock"
        else:
            stock = "unknown"
        image = str(item.get("image") or item.get("image_url") or "").strip()
        if not image.startswith(("http://", "https://")):
            image = ""
        extras = item.get("extras") if isinstance(item.get("extras"), dict) else {}
        products.append(
            {
                "external_id": str(item.get("id") or f"p{index}")[:120],
                "name": name[:300],
                "variant": str(item.get("variant") or "")[:200],
                "price": str(item.get("price") or "")[:80],
                "stock_status": stock,
                "source_url": str(item.get("url") or "")[:500],
                "image_url": image[:800],
                "category": str(item.get("category") or "")[:200],
                "item_number": str(item.get("item_number") or item.get("sku") or "")[:120],
                "batch_number": str(item.get("batch_number") or item.get("batch") or "")[:120],
                "extras": extras,
            }
        )
    return products


def ask_gemini(prompt: str, timeout: int = 30) -> str:
    if not GEMINI_API_KEY:
        return f"AI is not configured yet. {ESCALATE_MARKER}"

    last_error = "Gemini request failed."
    for model in GEMINI_MODELS:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={GEMINI_API_KEY}"
        )
        try:
            response = httpx.post(
                url,
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=timeout,
            )
            data = response.json()
            if response.is_success:
                parts = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(part.get("text", "") for part in parts).strip()
                if text:
                    return text
            last_error = data.get("error", {}).get("message", last_error)
        except Exception as error:
            last_error = str(error)

    return (
        "I could not generate an answer right now. "
        f"A teammate can take this from here. {ESCALATE_MARKER}\n({last_error})"
    )


def wants_try_on(text: str, has_photo: bool) -> bool:
    if has_photo:
        return True
    return bool(TRY_ON_RE.search(text or ""))


NOT_TRY_ON = (
    "electronic",
    "electronics",
    "gadget",
    "phone",
    "iphone",
    "smartphone",
    "laptop",
    "computer",
    "tablet",
    "charger",
    "cable",
    "adapter",
    "headphone",
    "earbud",
    "earphone",
    "speaker",
    "camera",
    "monitor",
    "keyboard",
    "mouse",
    "power bank",
    "powerbank",
    " tv",
    "console",
    "router",
    "appliance",
    "air conditioner",
    "air-conditioner",
    "aircon",
    "purifier",
    "refrigerator",
    "fridge",
    "freezer",
    "washing machine",
    "washer",
    "microwave",
    "oven",
    "stove",
    "cooker",
    "hob",
    "blender",
    "heater",
    "cooler",
    "inverter",
    "generator",
    "dishwasher",
    "vacuum",
    "shoe care",
    "polish",
    "cleaner",
    "insole",
)


def can_try_on_product(name: str, category: str = "", variant: str = "") -> bool:
    blob = f"{name} {category} {variant}".lower()
    return not any(word.strip() in blob for word in NOT_TRY_ON)


def _decode_image_b64(raw: object) -> bytes | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return base64.b64decode(raw)
    except Exception:
        return None


def _image_from_part(part: object) -> bytes | None:
    if not isinstance(part, dict):
        return None
    blob = part.get("inlineData") or part.get("inline_data") or {}
    if isinstance(blob, dict):
        image = _decode_image_b64(blob.get("data"))
        if image:
            return image
    if part.get("type") == "image" or part.get("mime_type") or part.get("mimeType"):
        image = _decode_image_b64(part.get("data"))
        if image:
            return image
    inner = part.get("image") or part.get("imageContent") or {}
    if isinstance(inner, dict):
        return _decode_image_b64(inner.get("data"))
    return None


def _extract_generated_image(data: dict) -> bytes | None:
    for candidate in data.get("candidates") or []:
        parts = (candidate.get("content") or {}).get("parts") or []
        for part in parts:
            image = _image_from_part(part)
            if image:
                return image
    output = data.get("output_image") or data.get("outputImage") or {}
    if isinstance(output, dict):
        image = _decode_image_b64(output.get("data"))
        if image:
            return image
    for item in data.get("outputs") or data.get("output") or []:
        image = _image_from_part(item)
        if image:
            return image
    steps = data.get("steps") or []
    interaction = data.get("interaction") or {}
    if isinstance(interaction, dict):
        steps = steps or interaction.get("steps") or []
    for step in steps:
        if not isinstance(step, dict):
            continue
        contents = list(step.get("content") or [])
        model_out = step.get("model_output") or step.get("modelOutput") or {}
        if isinstance(model_out, dict):
            contents.extend(model_out.get("content") or [])
        for part in contents:
            image = _image_from_part(part)
            if image:
                return image
    return None


def _is_missing_model(message: str) -> bool:
    lower = message.lower()
    return "not found" in lower or "is not supported" in lower


def _remember_error(current: str, incoming: str) -> str:
    incoming = (incoming or "").strip()
    if not incoming:
        return current
    if _is_missing_model(incoming) and current and not _is_missing_model(current):
        return current
    return incoming


def _friendly_image_error(message: str) -> str:
    lower = message.lower()
    if "free tier" in lower or "0 request" in lower or "0 input" in lower:
        return (
            "Gemini Free Tier blocks image try-on on this API key. "
            "Enable billing at https://ai.dev/rate-limit, then try again."
        )
    if "quota" in lower or "resource exhausted" in lower or "rate" in lower:
        return "Gemini image quota is used up right now. Try again in a few minutes."
    if _is_missing_model(message):
        return "The image model is unavailable right now. Try again in a moment."
    return message or "Image generation failed."


def generate_try_on_image(
    person: bytes,
    person_mime: str,
    garment: bytes,
    garment_mime: str,
    product_name: str,
) -> tuple[bytes | None, str]:
    if not GEMINI_API_KEY:
        return None, "AI is not configured yet."

    prompt = (
        f'Create a realistic virtual try-on photo of "{product_name}". '
        "The first image is the product. The second image is the customer. "
        "Dress the customer in this exact product. Keep their face, body, "
        "skin tone, hair, and pose the same. No extra people, logos, or text."
    )
    person_b64 = base64.b64encode(person).decode("ascii")
    garment_b64 = base64.b64encode(garment).decode("ascii")
    last_error = "Image generation failed."

    generate_body = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": garment_mime, "data": garment_b64}},
                    {"inline_data": {"mime_type": person_mime, "data": person_b64}},
                ]
            }
        ],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    interact_body = {
        "input": [
            {"type": "image", "mime_type": garment_mime, "data": garment_b64},
            {"type": "image", "mime_type": person_mime, "data": person_b64},
            {"type": "text", "text": prompt},
        ],
        "response_format": {"type": "image"},
    }

    for model in GEMINI_IMAGE_MODELS:
        try:
            response = httpx.post(
                "https://generativelanguage.googleapis.com/v1beta/interactions",
                headers={"x-goog-api-key": GEMINI_API_KEY},
                json={"model": model, **interact_body},
                timeout=90,
            )
            data = response.json()
            image = _extract_generated_image(data)
            if response.is_success and image:
                return image, ""
            message = data.get("error", {}).get("message", last_error)
            last_error = _remember_error(last_error, message)
            if _is_missing_model(message):
                continue
        except Exception as error:
            last_error = _remember_error(last_error, str(error))

        generate_url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={GEMINI_API_KEY}"
        )
        try:
            response = httpx.post(generate_url, json=generate_body, timeout=90)
            data = response.json()
            image = _extract_generated_image(data)
            if response.is_success and image:
                return image, ""
            last_error = _remember_error(
                last_error,
                data.get("error", {}).get("message", last_error),
            )
        except Exception as error:
            last_error = _remember_error(last_error, str(error))

    return None, _friendly_image_error(last_error)
