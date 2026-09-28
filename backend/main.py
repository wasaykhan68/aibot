import asyncio
import base64
import hashlib
import json
import os
import secrets

import httpx
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pathlib import Path

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ai import (
    ask_gemini,
    build_prompt,
    clean_answer,
    extract_products_from_text,
    generate_try_on_image,
    can_try_on_product,
    is_inventory_count_question,
    needs_owner_review,
    should_escalate,
    wants_try_on,
)
from voice import (
    DEFAULT_VOICE_SCRIPT,
    clone_voice,
    resolve_voice_id,
    synthesize_speech,
    voice_configured,
)
from database import Base, SessionLocal, engine, get_db
from knowledge import (
    CATALOG_STORE_LIMIT,
    catalog_inventory_stats,
    extract_contacts,
    extract_pdf_text,
    fetch_storefront_catalog,
    format_catalog_lines,
    format_catalog_snapshot,
    match_product_cards,
    pages_json,
    rebuild_knowledge,
    scrape_website,
    search_catalog,
)
from models import Conversation, Lead, Message, Product, TrainingRule, UnansweredQuery, User

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "aibot-dev-secret-change-me")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

Base.metadata.create_all(bind=engine)


def ensure_user_columns() -> None:
    statements = {
        "business_description": "TEXT DEFAULT ''",
        "website_url": "VARCHAR(500) DEFAULT ''",
        "pdf_name": "VARCHAR(255) DEFAULT ''",
        "pdf_text": "TEXT DEFAULT ''",
        "website_text": "TEXT DEFAULT ''",
        "scraped_pages": "TEXT DEFAULT '[]'",
        "support_phone": "VARCHAR(80) DEFAULT ''",
        "support_email": "VARCHAR(255) DEFAULT ''",
        "catalog_synced_at": "DATETIME",
        "training_text": "TEXT DEFAULT ''",
        "voice_script": "TEXT DEFAULT ''",
        "elevenlabs_voice_id": "VARCHAR(80) DEFAULT ''",
        "onboarding_completed": "INTEGER DEFAULT 0",
    }
    with engine.begin() as connection:
        existing = {
            row[1] for row in connection.execute(text("PRAGMA table_info(users)"))
        }
        for name, definition in statements.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))


def ensure_product_columns() -> None:
    statements = {
        "image_url": "VARCHAR(800) DEFAULT ''",
        "image_urls": "TEXT DEFAULT '[]'",
        "origin": "VARCHAR(20) DEFAULT 'catalog'",
        "category": "VARCHAR(200) DEFAULT ''",
        "item_number": "VARCHAR(120) DEFAULT ''",
        "batch_number": "VARCHAR(120) DEFAULT ''",
        "extras": "TEXT DEFAULT '{}'",
    }
    with engine.begin() as connection:
        existing = {
            row[1] for row in connection.execute(text("PRAGMA table_info(products)"))
        }
        for name, definition in statements.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE products ADD COLUMN {name} {definition}"))


def ensure_unanswered_columns() -> None:
    statements = {
        "status": "VARCHAR(32) DEFAULT 'open'",
        "taught_answer": "TEXT DEFAULT ''",
    }
    with engine.begin() as connection:
        existing = {
            row[1] for row in connection.execute(text("PRAGMA table_info(unanswered_queries)"))
        }
        for name, definition in statements.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE unanswered_queries ADD COLUMN {name} {definition}")
                )


def ensure_lead_columns() -> None:
    statements = {
        "visitor_id": "VARCHAR(80) DEFAULT ''",
    }
    with engine.begin() as connection:
        existing = {
            row[1] for row in connection.execute(text("PRAGMA table_info(leads)"))
        }
        for name, definition in statements.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE leads ADD COLUMN {name} {definition}"))


ensure_user_columns()
ensure_product_columns()
ensure_unanswered_columns()
ensure_lead_columns()

CATALOG_SYNC_SECONDS = 2 * 60 * 60


def sync_all_catalogs() -> None:
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.website_url != "").all()
        for user in users:
            try:
                refresh_product_catalog(db, user, allow_html_scrape=True)
                user.catalog_synced_at = datetime.now(timezone.utc)
                db.commit()
            except Exception:
                db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = asyncio.Event()

    async def loop():
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=CATALOG_SYNC_SECONDS)
            except asyncio.TimeoutError:
                pass
            if stop.is_set():
                break
            try:
                await asyncio.to_thread(sync_all_catalogs)
            except Exception:
                pass

    task = asyncio.create_task(loop())
    yield
    stop.set()
    task.cancel()


app = FastAPI(title="Aibot API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

Db = Annotated[Session, Depends(get_db)]


class SignupBody(BaseModel):
    companyName: str
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


class KnowledgeBody(BaseModel):
    knowledgeText: str


class KnowledgeSourcesBody(BaseModel):
    businessDescription: str = ""
    websiteUrl: str = ""
    pdfText: str | None = None
    websiteText: str | None = None


class ScrapeBody(BaseModel):
    websiteUrl: str


class VisitorInfo(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    extra: dict = Field(default_factory=dict)
    source: str = "widget"
    visitorId: str = ""


class WidgetMessageBody(BaseModel):
    widgetKey: str
    text: str = ""
    conversationId: int | None = None
    customerId: str | None = None
    visitor: VisitorInfo | None = None
    photoBase64: str = ""
    photoMime: str = "image/jpeg"
    productId: int | None = None


class TicketReplyBody(BaseModel):
    text: str


class TeachAnswerBody(BaseModel):
    answer: str


class SpeakBody(BaseModel):
    widgetKey: str
    text: str = ""


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return secrets.compare_digest(check.hex(), digest)


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def current_user(
    db: Db,
    authorization: str | None = Header(default=None),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please log in first.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired. Log in again.")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return user


def support_line(user: User) -> str:
    phone = (user.support_phone or "").strip()
    email = (user.support_email or "").strip()
    if not phone and not email:
        return ""
    parts = ["Customer support:"]
    if phone:
        parts.append(f"phone {phone}")
    if email:
        parts.append(f"email {email}")
    return " ".join(parts)


def cannot_answer_reply(user: User) -> str:
    phone = (user.support_phone or "").strip()
    email = (user.support_email or "").strip()
    if phone and email:
        return (
            "I can't answer this question right now. "
            f"Please call customer support at {phone} or email {email}."
        )
    if phone:
        return (
            "I can't answer this question right now. "
            f"Please call customer support at {phone}."
        )
    if email:
        return (
            "I can't answer this question right now. "
            f"Please email customer support at {email}."
        )
    return "I can't answer this question right now. Please contact customer support."


def apply_support_contacts(user: User) -> None:
    contacts = extract_contacts(
        "\n".join(
            part
            for part in [user.website_text, user.pdf_text, user.business_description]
            if part
        )
    )
    if contacts["phone"]:
        user.support_phone = contacts["phone"][:80]
    if contacts["email"]:
        user.support_email = contacts["email"][:255]


def upsert_lead(db: Session, user: User, visitor: VisitorInfo | None) -> Lead | None:
    if not visitor:
        return None
    name = (visitor.name or "").strip()[:200]
    email = (visitor.email or "").strip().lower()[:255]
    phone = (visitor.phone or "").strip()[:80]
    visitor_id = (visitor.visitorId or "").strip()[:80]
    extra = json.dumps(visitor.extra or {})[:4000]
    if not name and not email and not phone and not visitor_id and extra in {"{}", ""}:
        return None
    lead = None
    if visitor_id:
        lead = (
            db.query(Lead)
            .filter(Lead.business_id == user.id, Lead.visitor_id == visitor_id)
            .first()
        )
    if lead is None and email:
        lead = (
            db.query(Lead)
            .filter(Lead.business_id == user.id, Lead.email == email)
            .first()
        )
    if lead is None and phone:
        lead = (
            db.query(Lead)
            .filter(Lead.business_id == user.id, Lead.phone == phone)
            .first()
        )
    if lead is None:
        lead = Lead(
            business_id=user.id,
            name=name,
            email=email,
            phone=phone,
            extra=extra,
            source=(visitor.source or "widget")[:40],
            visitor_id=visitor_id,
        )
        db.add(lead)
        db.flush()
    else:
        lead.name = name or lead.name
        lead.email = email or lead.email
        lead.phone = phone or lead.phone
        lead.visitor_id = visitor_id or lead.visitor_id
        lead.extra = extra or lead.extra
        lead.updated_at = datetime.now(timezone.utc)
    return lead


def save_unanswered_query(
    db: Session,
    user: User,
    conversation: Conversation,
    question: str,
    reply: str,
    visitor: VisitorInfo | None,
    lead: Lead | None,
) -> UnansweredQuery:
    item = UnansweredQuery(
        business_id=user.id,
        conversation_id=conversation.id,
        lead_id=lead.id if lead else None,
        question=question,
        reply=reply,
        customer_name=(visitor.name if visitor else "")[:200],
        customer_email=(visitor.email if visitor else "")[:255],
        customer_phone=(visitor.phone if visitor else "")[:80],
    )
    db.add(item)
    return item


def lead_payload(item: Lead) -> dict:
    try:
        extra = json.loads(item.extra or "{}")
    except json.JSONDecodeError:
        extra = {}
    return {
        "id": item.id,
        "name": item.name or "",
        "email": item.email or "",
        "phone": item.phone or "",
        "extra": extra,
        "source": item.source,
        "createdAt": item.created_at.isoformat() if item.created_at else "",
        "updatedAt": item.updated_at.isoformat() if item.updated_at else "",
    }


def unanswered_payload(item: UnansweredQuery) -> dict:
    return {
        "id": item.id,
        "question": item.question,
        "reply": item.reply,
        "conversationId": item.conversation_id,
        "leadId": item.lead_id,
        "customerName": item.customer_name or "",
        "customerEmail": item.customer_email or "",
        "customerPhone": item.customer_phone or "",
        "createdAt": item.created_at.isoformat() if item.created_at else "",
        "status": item.status or "open",
        "taughtAnswer": item.taught_answer or "",
    }


def apply_knowledge(user: User, products: list[Product] | None = None) -> None:
    catalog = ""
    if products:
        preview = products[:CATALOG_STORE_LIMIT]
        extra = ""
        if len(products) > CATALOG_STORE_LIMIT:
            extra = (
                f"\n({len(products) - CATALOG_STORE_LIMIT} more products are in the live catalog. "
                "Use the snapshot counts above for totals.)"
            )
        catalog = "\n\n".join(
            part
            for part in [
                format_catalog_snapshot(products),
                format_catalog_lines(preview) + extra,
            ]
            if part
        )
    user.knowledge_text = "\n\n".join(
        part
        for part in [
            rebuild_knowledge(
                user.business_description or "",
                user.pdf_name or "",
                user.pdf_text or "",
                user.website_url or "",
                user.website_text or "",
            ),
            catalog,
            support_line(user),
            user.training_text or "",
        ]
        if part
    )


def chat_knowledge(user: User, products: list[Product], question: str) -> str:
    matches = search_catalog(products, question)
    return "\n\n".join(
        part
        for part in [
            rebuild_knowledge(
                user.business_description or "",
                user.pdf_name or "",
                user.pdf_text or "",
                user.website_url or "",
                user.website_text or "",
            ),
            format_catalog_snapshot(products) if products else "",
            format_catalog_lines(matches, "Matching products for this question:") if matches else "",
            support_line(user),
            user.training_text or "",
        ]
        if part
    )


def inventory_count_reply(products: list[Product]) -> str:
    stats = catalog_inventory_stats(products)
    if not stats["total"]:
        return "The catalog is still syncing, so I do not have a product count yet."
    return (
        f"We currently list {stats['total']:,} products: "
        f"{stats['in_stock']:,} in stock, "
        f"{stats['sold_out']:,} sold out, "
        f"and {stats['upcoming']:,} upcoming."
    )


def rebuild_training(db: Session, user: User) -> None:
    rules = (
        db.query(TrainingRule)
        .filter(TrainingRule.business_id == user.id)
        .order_by(TrainingRule.created_at.asc())
        .all()
    )
    taught = [item for item in rules if item.kind == "taught"]
    abuse = [item for item in rules if item.kind == "abuse"]
    out_of_context = [item for item in rules if item.kind == "out_of_context"]
    parts = []
    if taught:
        lines = ["Learned Q&A. If a customer asks something similar, use this answer:"]
        for item in taught:
            lines.append(f"Q: {item.question}\nA: {item.answer}")
        parts.append("\n".join(lines))
    if abuse:
        lines = [
            "Abuse examples. If a customer is rude or abusive like this, stay respectful, do not match their tone, and ask them to continue politely:"
        ]
        lines.extend(f"- {item.question}" for item in abuse)
        parts.append("\n".join(lines))
    if out_of_context:
        lines = [
            "Out of context examples. If a question is unrelated to this business like this, politely say it is outside your scope and steer back to products or support:"
        ]
        lines.extend(f"- {item.question}" for item in out_of_context)
        parts.append("\n".join(lines))
    user.training_text = "\n\n".join(parts)
    products = db.query(Product).filter(Product.business_id == user.id).all()
    apply_knowledge(user, products)


def apply_training_rule(
    db: Session,
    user: User,
    item: UnansweredQuery,
    kind: str,
    answer: str = "",
) -> UnansweredQuery:
    if (item.status or "open") != "open":
        raise HTTPException(status_code=400, detail="This query was already reviewed.")
    db.add(
        TrainingRule(
            business_id=user.id,
            kind=kind,
            question=item.question,
            answer=answer,
        )
    )
    item.status = kind
    item.taught_answer = answer
    rebuild_training(db, user)
    return item


def parse_image_urls(item: Product) -> list[str]:
    urls: list[str] = []
    try:
        raw = json.loads(item.image_urls or "[]")
    except json.JSONDecodeError:
        raw = []
    if isinstance(raw, list):
        urls.extend(str(url).strip() for url in raw if str(url).strip())
    if item.image_url and item.image_url not in urls:
        urls.insert(0, item.image_url)
    return urls[:12]


def product_payload(item: Product) -> dict:
    try:
        extras = json.loads(item.extras or "{}")
    except json.JSONDecodeError:
        extras = {}
    images = parse_image_urls(item)
    return {
        "id": item.id,
        "externalId": item.external_id,
        "name": item.name,
        "variant": item.variant,
        "price": item.price,
        "stockStatus": item.stock_status,
        "sourceUrl": item.source_url,
        "imageUrl": images[0] if images else "",
        "imageUrls": images,
        "category": item.category or "",
        "itemNumber": item.item_number or "",
        "batchNumber": item.batch_number or "",
        "origin": item.origin or "catalog",
        "extras": (
            {str(key): str(value) for key, value in extras.items() if value}
            if isinstance(extras, dict)
            else {}
        ),
    }


def refresh_product_catalog(
    db: Session,
    user: User,
    allow_html_scrape: bool = False,
) -> list[Product]:
    extracted = fetch_storefront_catalog(user.website_url or "")
    if not extracted and allow_html_scrape and (user.website_url or "").strip():
        website_text, pages = scrape_website(user.website_url)
        if website_text:
            user.website_text = website_text
            user.scraped_pages = pages_json(pages)
            apply_support_contacts(user)
    if not extracted:
        source = "\n\n".join(
            part
            for part in [user.business_description, user.pdf_text, user.website_text]
            if part and part.strip()
        )
        extracted = extract_products_from_text(source)
    db.query(Product).filter(
        Product.business_id == user.id,
        Product.origin != "manual",
    ).delete()
    products = []
    for item in extracted:
        extras = item.pop("extras", {}) if isinstance(item, dict) else {}
        image_urls = item.pop("image_urls", []) if isinstance(item, dict) else []
        if not isinstance(extras, dict):
            extras = {}
        if not isinstance(image_urls, list):
            image_urls = []
        primary = str(item.get("image_url") or "").strip()
        if primary and primary not in image_urls:
            image_urls = [primary, *image_urls]
        item["image_url"] = (image_urls[0] if image_urls else "")[:800]
        item["origin"] = "catalog"
        product = Product(
            business_id=user.id,
            extras=json.dumps(extras),
            image_urls=json.dumps(image_urls[:12]),
            **item,
        )
        db.add(product)
        products.append(product)
    db.flush()
    manuals = (
        db.query(Product)
        .filter(Product.business_id == user.id, Product.origin == "manual")
        .all()
    )
    combined = manuals + products
    apply_knowledge(user, combined)
    user.catalog_synced_at = datetime.now(timezone.utc)
    return combined


def settings_payload(user: User) -> dict:
    try:
        pages = json.loads(user.scraped_pages or "[]")
    except json.JSONDecodeError:
        pages = []
    return {
        "businessDescription": user.business_description or "",
        "websiteUrl": user.website_url or "",
        "pdfName": user.pdf_name or "",
        "pdfText": user.pdf_text or "",
        "websiteText": user.website_text or "",
        "supportPhone": user.support_phone or "",
        "supportEmail": user.support_email or "",
        "scrapedPages": pages,
        "voiceScript": user.voice_script or DEFAULT_VOICE_SCRIPT,
        "voiceReady": voice_configured(),
        "voiceCloned": bool((user.elevenlabs_voice_id or "").strip()),
        "voiceConfigured": voice_configured(),
    }


async def apply_training_fields(
    user: User,
    db: Session,
    business_description: str,
    website_url: str,
    pdf: UploadFile | None,
    scrape_website_url: bool,
) -> None:
    user.business_description = business_description
    user.website_url = website_url.strip()

    if pdf and pdf.filename:
        if not pdf.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Please upload a PDF file.")
        data = await pdf.read()
        if not data:
            raise HTTPException(status_code=400, detail="The PDF file is empty.")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="PDF must be smaller than 10MB.")
        try:
            extracted = extract_pdf_text(data)
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read that PDF.")
        if not extracted:
            raise HTTPException(status_code=400, detail="No readable text was found in that PDF.")
        user.pdf_name = pdf.filename
        user.pdf_text = extracted

    if scrape_website_url and website_url.strip():
        website_text, pages = scrape_website(website_url)
        if website_text:
            user.website_text = website_text
            user.scraped_pages = pages_json(pages)

    apply_support_contacts(user)
    if user.website_text or user.pdf_text or user.business_description:
        refresh_product_catalog(db, user)
    else:
        apply_knowledge(user)
    user.onboarding_completed = True


def user_payload(user: User) -> dict:
    try:
        pages = json.loads(user.scraped_pages or "[]")
    except json.JSONDecodeError:
        pages = []
    completed = bool(user.onboarding_completed)
    return {
        "id": user.id,
        "companyName": user.company_name,
        "email": user.email,
        "widgetKey": user.widget_key,
        "knowledgeText": user.knowledge_text or "",
        "businessDescription": user.business_description or "",
        "websiteUrl": user.website_url or "",
        "pdfName": user.pdf_name or "",
        "pdfText": user.pdf_text or "",
        "websiteText": user.website_text or "",
        "supportPhone": user.support_phone or "",
        "supportEmail": user.support_email or "",
        "scrapedPages": pages,
        "onboardingCompleted": completed,
        "catalogSyncedAt": user.catalog_synced_at.isoformat() if user.catalog_synced_at else "",
        "needsOnboarding": not completed,
        "embedCode": (
            f'<script src="{FRONTEND_URL}/widget.js" data-key="{user.widget_key}"></script>'
        ),
    }


def conversation_payload(conversation: Conversation) -> dict:
    return {
        "id": conversation.id,
        "status": conversation.status,
        "customerId": conversation.customer_id,
        "createdAt": conversation.created_at.isoformat(),
        "messages": [
            {
                "id": message.id,
                "sender": message.sender,
                "text": message.text,
                "timestamp": message.timestamp.isoformat(),
            }
            for message in conversation.messages
        ],
    }


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/signup")
def signup(body: SignupBody, db: Db):
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    user = User(
        company_name=body.companyName.strip(),
        email=email,
        password_hash=hash_password(body.password),
        widget_key=f"wb_{secrets.token_urlsafe(12)}",
        knowledge_text="",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_token(user.id), "user": user_payload(user)}


@app.post("/api/auth/login")
def login(body: LoginBody, db: Db):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid email or password.")
    return {"token": create_token(user.id), "user": user_payload(user)}


@app.get("/api/me")
def me(user: Annotated[User, Depends(current_user)]):
    return user_payload(user)


@app.put("/api/knowledge")
def update_knowledge(
    body: KnowledgeBody,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    user.knowledge_text = body.knowledgeText
    db.commit()
    db.refresh(user)
    return user_payload(user)


@app.put("/api/knowledge/sources")
def update_knowledge_sources(
    body: KnowledgeSourcesBody,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    user.business_description = body.businessDescription
    user.website_url = body.websiteUrl.strip()
    if body.pdfText is not None:
        user.pdf_text = body.pdfText
    if body.websiteText is not None:
        user.website_text = body.websiteText
    apply_knowledge(user)
    user.onboarding_completed = True
    db.commit()
    db.refresh(user)
    return user_payload(user)


@app.get("/api/chatbot/settings")
def get_chatbot_settings(user: Annotated[User, Depends(current_user)]):
    return settings_payload(user)


def catalog_response(user: User, products: list[Product]) -> dict:
    categories = sorted({item.category for item in products if (item.category or "").strip()})
    return {
        "products": [product_payload(item) for item in products],
        "categories": categories,
        "syncedAt": user.catalog_synced_at.isoformat() if user.catalog_synced_at else "",
    }


def decode_photo(raw: str, mime: str) -> tuple[bytes, str]:
    value = (raw or "").strip()
    if "," in value and value.startswith("data:"):
        header, value = value.split(",", 1)
        if "image/" in header and not mime:
            mime = header.split(";")[0].split(":")[-1]
    try:
        data = base64.b64decode(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Photo could not be read.") from exc
    if len(data) < 80 or len(data) > 8_000_000:
        raise HTTPException(status_code=400, detail="Photo must be an image under 8MB.")
    allowed = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
    next_mime = mime if mime in allowed else "image/jpeg"
    return data, next_mime


def load_image_bytes(url: str) -> tuple[bytes, str]:
    if url.startswith("/uploads/"):
        path = (UPLOAD_DIR / url.removeprefix("/uploads/")).resolve()
        if not str(path).startswith(str(UPLOAD_DIR.resolve())) or not path.is_file():
            raise HTTPException(status_code=400, detail="Product image is missing.")
        suffix = path.suffix.lower()
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
            suffix, "image/jpeg"
        )
        return path.read_bytes(), mime
    response = httpx.get(url, timeout=20, follow_redirects=True)
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Could not download the product photo.")
    mime = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
    return response.content, mime if mime.startswith("image/") else "image/jpeg"


def save_generated_image(user_id: int, data: bytes) -> str:
    folder = UPLOAD_DIR / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"tryon_{secrets.token_urlsafe(10)}.png"
    (folder / name).write_bytes(data)
    return f"/uploads/{user_id}/{name}"


def save_product_images(user_id: int, files: list[UploadFile]) -> list[str]:
    folder = UPLOAD_DIR / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for upload in files[:8]:
        filename = (upload.filename or "").lower()
        if not filename.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
            continue
        ext = Path(filename).suffix or ".jpg"
        name = f"{secrets.token_urlsafe(10)}{ext}"
        path = folder / name
        path.write_bytes(upload.file.read())
        saved.append(f"/uploads/{user_id}/{name}")
    return saved


@app.get("/api/products")
def list_products(
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    products = (
        db.query(Product)
        .filter(Product.business_id == user.id)
        .order_by(Product.origin.desc(), Product.id.desc())
        .all()
    )
    has_source = bool(
        user.website_url or user.website_text or user.pdf_text or user.business_description
    )
    if not products and has_source:
        products = refresh_product_catalog(db, user, allow_html_scrape=False)
        db.commit()
    return catalog_response(user, products)


@app.post("/api/products/sync")
def sync_products(db: Db, user: Annotated[User, Depends(current_user)]):
    if not (user.website_url or user.website_text or user.pdf_text or user.business_description):
        raise HTTPException(status_code=400, detail="Add a website or PDF in Chatbot settings first.")
    products = refresh_product_catalog(db, user, allow_html_scrape=True)
    db.commit()
    db.refresh(user)
    return catalog_response(user, products)


@app.post("/api/products")
async def create_manual_product(
    db: Db,
    user: Annotated[User, Depends(current_user)],
    name: str = Form(...),
    variant: str = Form(""),
    price: str = Form(""),
    stockStatus: str = Form("in_stock"),
    category: str = Form(""),
    itemNumber: str = Form(""),
    batchNumber: str = Form(""),
    sourceUrl: str = Form(""),
    imageUrls: str = Form("[]"),
    images: list[UploadFile] | None = File(None),
):
    title = name.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Product name is required.")
    try:
        pasted = json.loads(imageUrls or "[]")
    except json.JSONDecodeError:
        pasted = []
    urls = [str(url).strip() for url in pasted if str(url).strip()] if isinstance(pasted, list) else []
    urls.extend(save_product_images(user.id, images or []))
    unique: list[str] = []
    for url in urls:
        if url and url not in unique:
            unique.append(url[:800])
    stock = stockStatus if stockStatus in {"in_stock", "out_of_stock", "coming_soon", "unknown"} else "unknown"
    product = Product(
        business_id=user.id,
        external_id=f"manual_{secrets.token_urlsafe(8)}"[:120],
        name=title[:300],
        variant=variant.strip()[:200],
        price=price.strip()[:80],
        stock_status=stock,
        source_url=sourceUrl.strip()[:500],
        image_url=(unique[0] if unique else "")[:800],
        image_urls=json.dumps(unique[:12]),
        category=category.strip()[:200],
        item_number=itemNumber.strip()[:120],
        batch_number=batchNumber.strip()[:120],
        extras="{}",
        origin="manual",
    )
    db.add(product)
    db.flush()
    all_products = (
        db.query(Product)
        .filter(Product.business_id == user.id)
        .order_by(Product.origin.desc(), Product.id.desc())
        .all()
    )
    apply_knowledge(user, all_products)
    db.commit()
    db.refresh(product)
    return catalog_response(user, all_products)


@app.post("/api/chatbot/settings")
async def save_chatbot_settings(
    db: Db,
    user: Annotated[User, Depends(current_user)],
    businessDescription: str = Form(""),
    websiteUrl: str = Form(""),
    voiceScript: str = Form(""),
    pdf: UploadFile | None = File(None),
):
    previous_url = (user.website_url or "").strip()
    next_url = websiteUrl.strip()
    should_scrape = bool(next_url) and next_url != previous_url
    await apply_training_fields(
        user,
        db,
        businessDescription,
        websiteUrl,
        pdf,
        scrape_website_url=should_scrape or (bool(next_url) and not (user.website_text or "")),
    )
    if voiceScript.strip():
        user.voice_script = voiceScript.strip()
    db.commit()
    db.refresh(user)
    return settings_payload(user)


@app.post("/api/chatbot/voice")
async def save_chatbot_voice(
    db: Db,
    user: Annotated[User, Depends(current_user)],
    samples: list[UploadFile] | None = File(None),
):
    files: list[tuple[str, bytes, str]] = []
    for upload in samples or []:
        data = await upload.read()
        if not data or len(data) < 2000:
            continue
        if len(data) > 12 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Each voice sample must be under 12MB.")
        filename = upload.filename or "sample.webm"
        mime = upload.content_type or "application/octet-stream"
        files.append((filename, data, mime))
    if not files:
        raise HTTPException(
            status_code=400,
            detail="Record or upload a clear voice sample of at least a few seconds.",
        )
    voice_id, error = clone_voice(
        f"{user.company_name} assistant",
        files,
        user.elevenlabs_voice_id or "",
    )
    if not voice_id:
        raise HTTPException(status_code=400, detail=error)
    user.elevenlabs_voice_id = voice_id
    db.commit()
    db.refresh(user)
    return settings_payload(user)


@app.get("/api/widget/voice")
def widget_voice(widgetKey: str, db: Db):
    user = db.query(User).filter(User.widget_key == widgetKey).first()
    if not user:
        raise HTTPException(status_code=404, detail="Widget key is invalid.")
    return {
        "voiceReady": voice_configured(),
    }


@app.post("/api/widget/speak")
def widget_speak(body: SpeakBody, db: Db):
    user = db.query(User).filter(User.widget_key == body.widgetKey).first()
    if not user:
        raise HTTPException(status_code=404, detail="Widget key is invalid.")
    if not voice_configured():
        raise HTTPException(status_code=400, detail="ElevenLabs is not configured.")
    audio, mime, error = synthesize_speech(
        resolve_voice_id(user.elevenlabs_voice_id or ""),
        body.text,
    )
    if not audio:
        raise HTTPException(status_code=400, detail=error)
    return Response(content=audio, media_type=mime)


@app.post("/api/knowledge/pdf")
async def upload_knowledge_pdf(
    db: Db,
    user: Annotated[User, Depends(current_user)],
    pdf: UploadFile = File(...),
):
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")
    data = await pdf.read()
    if not data:
        raise HTTPException(status_code=400, detail="The PDF file is empty.")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF must be smaller than 10MB.")
    try:
        extracted = extract_pdf_text(data)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read that PDF.")
    if not extracted:
        raise HTTPException(status_code=400, detail="No readable text was found in that PDF.")
    user.pdf_name = pdf.filename
    user.pdf_text = extracted
    refresh_product_catalog(db, user)
    user.onboarding_completed = True
    db.commit()
    db.refresh(user)
    return user_payload(user)


@app.post("/api/knowledge/scrape")
def scrape_knowledge_website(
    body: ScrapeBody,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    website_text, pages = scrape_website(body.websiteUrl)
    if not website_text:
        raise HTTPException(
            status_code=400,
            detail="Could not read pages from that website. Check the domain and try again.",
        )
    user.website_url = body.websiteUrl.strip()
    user.website_text = website_text
    user.scraped_pages = pages_json(pages)
    refresh_product_catalog(db, user)
    user.onboarding_completed = True
    db.commit()
    db.refresh(user)
    return user_payload(user)


@app.post("/api/onboarding")
async def complete_onboarding(
    db: Db,
    user: Annotated[User, Depends(current_user)],
    businessDescription: str = Form(""),
    websiteUrl: str = Form(""),
    pdf: UploadFile | None = File(None),
):
    if not businessDescription.strip() and not websiteUrl.strip() and pdf is None:
        raise HTTPException(
            status_code=400,
            detail="Add a description, a website, or a PDF so the chatbot can learn.",
        )

    await apply_training_fields(
        user,
        db,
        businessDescription,
        websiteUrl,
        pdf,
        scrape_website_url=bool(websiteUrl.strip()),
    )
    db.commit()
    db.refresh(user)
    return user_payload(user)


@app.post("/api/widget/message")
def widget_message(body: WidgetMessageBody, db: Db):
    user = db.query(User).filter(User.widget_key == body.widgetKey).first()
    if not user:
        raise HTTPException(status_code=404, detail="Widget key is invalid.")

    conversation = None
    if body.conversationId:
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == body.conversationId,
                Conversation.business_id == user.id,
            )
            .first()
        )
    if not conversation:
        conversation = Conversation(
            business_id=user.id,
            customer_id=body.customerId or secrets.token_hex(8),
            status="ai_handling",
        )
        db.add(conversation)
        db.flush()

    question = body.text.strip() or ("Try this on me" if body.photoBase64 else "")
    if not question:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    db.add(Message(conversation_id=conversation.id, sender="customer", text=question))
    db.flush()

    history = [
        {"sender": message.sender, "text": message.text}
        for message in conversation.messages
    ]
    products = db.query(Product).filter(Product.business_id == user.id).all()
    if not (user.support_phone or user.support_email):
        apply_support_contacts(user)
    knowledge = chat_knowledge(user, products, question)

    generated_image = ""
    try_on = wants_try_on(question, bool(body.photoBase64))
    if try_on:
        chosen = None
        if body.productId:
            chosen = (
                db.query(Product)
                .filter(Product.id == body.productId, Product.business_id == user.id)
                .first()
            )
        if chosen is None:
            matches = match_product_cards(products, question, "", history, limit=1)
            chosen = matches[0] if matches else None
        if chosen and not can_try_on_product(chosen.name, chosen.category, chosen.variant):
            answer = (
                f"{chosen.name} is not something I can try on a photo. "
                "Try on is for clothes, shoes, and similar wearables."
            )
            escalated = False
        elif not body.photoBase64:
            answer = (
                "Upload your photo and I will try the product on you. "
                "You can also tap Try on me on a product card."
            )
            escalated = False
        elif chosen is None:
            answer = (
                "I can put a catalog item on your photo. Tell me the product name, "
                "or tap Try on me on a product first."
            )
            escalated = False
        else:
            images = parse_image_urls(chosen)
            if not images:
                answer = f"I found {chosen.name}, but it has no photo to try on."
                escalated = False
            else:
                person, person_mime = decode_photo(body.photoBase64, body.photoMime)
                garment, garment_mime = load_image_bytes(images[0])
                image_bytes, image_error = generate_try_on_image(
                    person,
                    person_mime,
                    garment,
                    garment_mime,
                    f"{chosen.name} {chosen.variant}".strip(),
                )
                if image_bytes:
                    generated_image = save_generated_image(user.id, image_bytes)
                    answer = (
                        f"Here's an AI preview of you in {chosen.name}. "
                        "It's a visualization, not an exact fit."
                    )
                    escalated = False
                else:
                    answer = (
                        "I couldn't generate the try-on right now. "
                        f"Try again in a moment. ({image_error})"
                    )
                    escalated = False
        gemini_answer = answer
    elif is_inventory_count_question(question) and not search_catalog(products, question):
        answer = inventory_count_reply(products)
        gemini_answer = answer
        escalated = False
    else:
        raw_answer = ask_gemini(
            build_prompt(user.company_name, knowledge, history, question)
        )
        escalated = should_escalate(question, raw_answer)
        gemini_answer = clean_answer(raw_answer) or "Let me connect you with a teammate."
        keep_reply = is_inventory_count_question(question) or needs_owner_review(question)
        if keep_reply:
            escalated = True if needs_owner_review(question) else False
            answer = gemini_answer
        else:
            answer = cannot_answer_reply(user) if escalated else gemini_answer

    lead = upsert_lead(db, user, body.visitor)

    db.add(Message(conversation_id=conversation.id, sender="ai", text=answer))
    if escalated:
        conversation.status = "escalated"
        save_unanswered_query(db, user, conversation, question, gemini_answer, body.visitor, lead)
    db.commit()
    db.refresh(conversation)

    cards = match_product_cards(products, question, answer, history)
    if try_on and body.productId:
        extra = next((item for item in products if item.id == body.productId), None)
        if extra and extra not in cards:
            cards = [extra, *cards][:3]
    return {
        "conversationId": conversation.id,
        "status": conversation.status,
        "reply": answer,
        "escalated": escalated,
        "products": [product_payload(item) for item in cards],
        "generatedImage": generated_image,
    }


@app.get("/api/widget/history/{conversation_id}")
def widget_history(conversation_id: int, widgetKey: str, db: Db):
    user = db.query(User).filter(User.widget_key == widgetKey).first()
    if not user:
        raise HTTPException(status_code=404, detail="Widget key is invalid.")
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.business_id == user.id,
        )
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation_payload(conversation)


@app.get("/api/leads")
def list_leads(db: Db, user: Annotated[User, Depends(current_user)]):
    leads = (
        db.query(Lead)
        .filter(Lead.business_id == user.id)
        .order_by(Lead.updated_at.desc())
        .all()
    )
    unanswered = (
        db.query(UnansweredQuery)
        .filter(UnansweredQuery.business_id == user.id)
        .order_by(UnansweredQuery.created_at.desc())
        .all()
    )
    return {
        "leads": [lead_payload(item) for item in leads],
        "unanswered": [unanswered_payload(item) for item in unanswered],
    }


@app.post("/api/unanswered/{query_id}/teach")
def teach_unanswered(
    query_id: int,
    body: TeachAnswerBody,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    item = (
        db.query(UnansweredQuery)
        .filter(UnansweredQuery.id == query_id, UnansweredQuery.business_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Query not found.")
    answer = body.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Write the answer the bot should use next time.")
    apply_training_rule(db, user, item, "taught", answer)
    db.commit()
    db.refresh(item)
    return unanswered_payload(item)


@app.post("/api/unanswered/{query_id}/abuse")
def mark_unanswered_abuse(
    query_id: int,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    item = (
        db.query(UnansweredQuery)
        .filter(UnansweredQuery.id == query_id, UnansweredQuery.business_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Query not found.")
    apply_training_rule(db, user, item, "abuse")
    db.commit()
    db.refresh(item)
    return unanswered_payload(item)


@app.post("/api/unanswered/{query_id}/out-of-context")
def mark_unanswered_out_of_context(
    query_id: int,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    item = (
        db.query(UnansweredQuery)
        .filter(UnansweredQuery.id == query_id, UnansweredQuery.business_id == user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Query not found.")
    apply_training_rule(db, user, item, "out_of_context")
    db.commit()
    db.refresh(item)
    return unanswered_payload(item)


@app.get("/api/tickets")
def list_tickets(db: Db, user: Annotated[User, Depends(current_user)]):
    tickets = (
        db.query(Conversation)
        .filter(
            Conversation.business_id == user.id,
            Conversation.status == "escalated",
        )
        .order_by(Conversation.created_at.desc())
        .all()
    )
    return [conversation_payload(ticket) for ticket in tickets]


@app.get("/api/tickets/{ticket_id}")
def get_ticket(ticket_id: int, db: Db, user: Annotated[User, Depends(current_user)]):
    ticket = (
        db.query(Conversation)
        .filter(Conversation.id == ticket_id, Conversation.business_id == user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return conversation_payload(ticket)


@app.post("/api/tickets/{ticket_id}/reply")
def reply_ticket(
    ticket_id: int,
    body: TicketReplyBody,
    db: Db,
    user: Annotated[User, Depends(current_user)],
):
    ticket = (
        db.query(Conversation)
        .filter(Conversation.id == ticket_id, Conversation.business_id == user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Reply cannot be empty.")
    db.add(Message(conversation_id=ticket.id, sender="agent", text=body.text.strip()))
    ticket.status = "escalated"
    db.commit()
    db.refresh(ticket)
    return conversation_payload(ticket)


@app.patch("/api/tickets/{ticket_id}/resolve")
def resolve_ticket(ticket_id: int, db: Db, user: Annotated[User, Depends(current_user)]):
    ticket = (
        db.query(Conversation)
        .filter(Conversation.id == ticket_id, Conversation.business_id == user.id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    ticket.status = "resolved"
    db.commit()
    db.refresh(ticket)
    return conversation_payload(ticket)


@app.get("/api/stats")
def stats(db: Db, user: Annotated[User, Depends(current_user)]):
    conversations = (
        db.query(Conversation).filter(Conversation.business_id == user.id).all()
    )
    total = len(conversations)
    escalated = sum(1 for item in conversations if item.status == "escalated")
    resolved = sum(1 for item in conversations if item.status == "resolved")
    ai_resolved = sum(
        1
        for item in conversations
        if item.status == "resolved"
        and not any(message.sender == "agent" for message in item.messages)
    )
    agent_resolved = resolved - ai_resolved
    ai_handling = sum(1 for item in conversations if item.status == "ai_handling")

    days = []
    today = datetime.now(timezone.utc).date()
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        count = 0
        for item in conversations:
            created = item.created_at
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created.date() == day:
                count += 1
        days.append({"date": day.isoformat(), "chats": count})

    products = db.query(Product).filter(Product.business_id == user.id).all()
    in_stock = sum(1 for item in products if item.stock_status == "in_stock")
    sold_out = sum(1 for item in products if item.stock_status == "out_of_stock")
    upcoming = sum(1 for item in products if item.stock_status == "coming_soon")
    lead_count = db.query(Lead).filter(Lead.business_id == user.id).count()
    unanswered_count = (
        db.query(UnansweredQuery)
        .filter(
            UnansweredQuery.business_id == user.id,
            UnansweredQuery.status.in_(["open", ""]),
        )
        .count()
    )

    return {
        "totalChats": total,
        "aiHandling": ai_handling,
        "aiResolved": ai_resolved + ai_handling,
        "escalated": escalated,
        "agentResolved": agent_resolved,
        "daily": days,
        "totalLeads": lead_count,
        "unanswered": unanswered_count,
        "totalProducts": len(products),
        "inStock": in_stock,
        "soldOut": sold_out,
        "upcoming": upcoming,
    }
