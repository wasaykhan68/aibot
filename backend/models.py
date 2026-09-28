from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    widget_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    knowledge_text: Mapped[str] = mapped_column(Text, default="")
    business_description: Mapped[str] = mapped_column(Text, default="")
    website_url: Mapped[str] = mapped_column(String(500), default="")
    pdf_name: Mapped[str] = mapped_column(String(255), default="")
    pdf_text: Mapped[str] = mapped_column(Text, default="")
    website_text: Mapped[str] = mapped_column(Text, default="")
    scraped_pages: Mapped[str] = mapped_column(Text, default="[]")
    support_phone: Mapped[str] = mapped_column(String(80), default="")
    support_email: Mapped[str] = mapped_column(String(255), default="")
    catalog_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    training_text: Mapped[str] = mapped_column(Text, default="")
    voice_script: Mapped[str] = mapped_column(Text, default="")
    elevenlabs_voice_id: Mapped[str] = mapped_column(String(80), default="")
    onboarding_completed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    conversations: Mapped[list["Conversation"]] = relationship(back_populates="business")
    products: Mapped[list["Product"]] = relationship(
        back_populates="business",
        cascade="all, delete-orphan",
    )
    leads: Mapped[list["Lead"]] = relationship(
        back_populates="business",
        cascade="all, delete-orphan",
    )
    unanswered: Mapped[list["UnansweredQuery"]] = relationship(
        back_populates="business",
        cascade="all, delete-orphan",
    )
    training_rules: Mapped[list["TrainingRule"]] = relationship(
        back_populates="business",
        cascade="all, delete-orphan",
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(120), default="")
    name: Mapped[str] = mapped_column(String(300))
    variant: Mapped[str] = mapped_column(String(200), default="")
    price: Mapped[str] = mapped_column(String(80), default="")
    stock_status: Mapped[str] = mapped_column(String(32), default="unknown")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    image_url: Mapped[str] = mapped_column(String(800), default="")
    image_urls: Mapped[str] = mapped_column(Text, default="[]")
    category: Mapped[str] = mapped_column(String(200), default="")
    item_number: Mapped[str] = mapped_column(String(120), default="")
    batch_number: Mapped[str] = mapped_column(String(120), default="")
    extras: Mapped[str] = mapped_column(Text, default="{}")
    origin: Mapped[str] = mapped_column(String(20), default="catalog")

    business: Mapped[User] = relationship(back_populates="products")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="ai_handling")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    business: Mapped[User] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.timestamp",
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    sender: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(80), default="")
    extra: Mapped[str] = mapped_column(Text, default="{}")
    source: Mapped[str] = mapped_column(String(40), default="widget")
    visitor_id: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    business: Mapped[User] = relationship(back_populates="leads")


class UnansweredQuery(Base):
    __tablename__ = "unanswered_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id"), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    reply: Mapped[str] = mapped_column(Text, default="")
    customer_name: Mapped[str] = mapped_column(String(200), default="")
    customer_email: Mapped[str] = mapped_column(String(255), default="")
    customer_phone: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(32), default="open")
    taught_answer: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    business: Mapped[User] = relationship(back_populates="unanswered")


class TrainingRule(Base):
    __tablename__ = "training_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    business: Mapped[User] = relationship(back_populates="training_rules")
