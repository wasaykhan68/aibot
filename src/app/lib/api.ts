export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TOKEN_KEY = "aibot_token";
const USER_KEY = "aibot_user";

export type ScrapedPage = {
  url: string;
  title: string;
};

export type ChatbotSettingsData = {
  businessDescription: string;
  websiteUrl: string;
  pdfName: string;
  pdfText: string;
  websiteText: string;
  scrapedPages: ScrapedPage[];
  voiceScript?: string;
  voiceReady?: boolean;
  voiceCloned?: boolean;
  voiceConfigured?: boolean;
};

export type AuthUser = {
  id: number;
  companyName: string;
  email: string;
  widgetKey: string;
  knowledgeText: string;
  businessDescription: string;
  websiteUrl: string;
  pdfName: string;
  pdfText: string;
  websiteText: string;
  scrapedPages: ScrapedPage[];
  supportPhone?: string;
  supportEmail?: string;
  onboardingCompleted: boolean;
  catalogSyncedAt?: string;
  needsOnboarding: boolean;
  embedCode: string;
};

export type CatalogProduct = {
  id: number;
  externalId: string;
  name: string;
  variant: string;
  price: string;
  stockStatus: "in_stock" | "out_of_stock" | "unknown" | string;
  sourceUrl: string;
  imageUrl?: string;
  imageUrls?: string[];
  category?: string;
  itemNumber?: string;
  batchNumber?: string;
  origin?: "catalog" | "manual" | string;
  extras?: Record<string, string>;
};

export function productImageSrc(url: string) {
  if (!url) return "";
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  return url;
}

export function productImages(product: CatalogProduct) {
  const urls = [...(product.imageUrls || [])];
  if (product.imageUrl && !urls.includes(product.imageUrl)) {
    urls.unshift(product.imageUrl);
  }
  return urls.map(productImageSrc).filter(Boolean);
}

const NOT_TRY_ON = [
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
  "tv",
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
];

export function canTryOnProduct(product: CatalogProduct) {
  const blob = `${product.name} ${product.category || ""} ${product.variant || ""}`.toLowerCase();
  return !NOT_TRY_ON.some((word) => blob.includes(word));
}

export type CatalogResponse = {
  products: CatalogProduct[];
  categories: string[];
  syncedAt: string;
};

export type Stats = {
  totalChats: number;
  aiHandling: number;
  aiResolved: number;
  escalated: number;
  agentResolved: number;
  daily: { date: string; chats: number }[];
  totalLeads: number;
  unanswered: number;
  totalProducts: number;
  inStock: number;
  soldOut: number;
  upcoming: number;
};

export type LeadItem = {
  id: number;
  name: string;
  email: string;
  phone: string;
  extra: Record<string, string>;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type UnansweredItem = {
  id: number;
  question: string;
  reply: string;
  conversationId: number | null;
  leadId: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
  status: "open" | "taught" | "abuse" | "out_of_context" | string;
  taughtAnswer?: string;
};

export type LeadsResponse = {
  leads: LeadItem[];
  unanswered: UnansweredItem[];
};

export type VisitorPayload = {
  name: string;
  email: string;
  phone: string;
  extra: Record<string, string>;
  source: string;
  visitorId?: string;
};

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (
    !headers.has("Content-Type") &&
    options.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed.");
  }
  return data as T;
}
