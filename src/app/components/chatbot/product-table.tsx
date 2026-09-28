"use client";

import { useEffect, useMemo, useState } from "react";
import { api, CatalogProduct, CatalogResponse, productImages } from "@/app/lib/api";
import AddProductModal from "@/app/components/chatbot/add-product-modal";
import ProductImagePreview from "@/app/components/chatbot/product-image-preview";

export default function ProductTable() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [syncedAt, setSyncedAt] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  function applyCatalog(data: CatalogResponse) {
    setProducts(data.products || []);
    setCategories(data.categories || []);
    setSyncedAt(data.syncedAt || "");
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        applyCatalog(await api<CatalogResponse>("/api/products"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load products.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      applyCatalog(await api<CatalogResponse>("/api/products/sync", { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync catalog.");
    } finally {
      setSyncing(false);
    }
  }

  const extraKeys = useMemo(() => {
    const keys = new Set<string>();
    products.forEach((item) => {
      Object.entries(item.extras || {}).forEach(([key, value]) => {
        if (key && value) keys.add(key);
      });
    });
    return Array.from(keys);
  }, [products]);

  const showCategory = products.some((item) => item.category);
  const showItemNumber = products.some((item) => item.itemNumber);
  const showBatch = products.some((item) => item.batchNumber);
  const showVariant = products.some((item) => item.variant);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!needle) return true;
      return [
        item.name,
        item.variant,
        item.category,
        item.itemNumber,
        item.batchNumber,
        item.externalId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [products, category, query]);

  function stockLabel(status: string) {
    if (status === "in_stock") return "In stock";
    if (status === "out_of_stock") return "Out of stock";
    if (status === "coming_soon") return "Upcoming";
    return "Unknown";
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-slate-500">
            Catalog is stored in the database and refreshed every 2 hours. Opening
            this page does not scrape the website again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-lg border border-[#163532] px-4 py-2 text-sm font-medium text-[#163532]"
          >
            Add product
          </button>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="rounded-lg bg-[#163532] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Business catalog</h2>
            <p className="mt-1 text-xs text-slate-500">
              Columns appear only when this business has that data — category,
              item number, batch, and extra fields.
              {syncedAt
                ? ` Last synced ${syncedAt.replace("T", " ").slice(0, 16)} UTC.`
                : ""}
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading saved catalog...</p>
        ) : error ? (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        ) : products.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No products yet. Add a website in Chatbot settings, or tap Sync now.
          </p>
        ) : (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategory("all")}
                className={`rounded-full px-3 py-1 text-xs ${
                  category === "all"
                    ? "bg-[#163532] text-white"
                    : "bg-[#f6f4ef] text-slate-600"
                }`}
              >
                All ({products.length})
              </button>
              {categories.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(name)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    category === name
                      ? "bg-[#163532] text-white"
                      : "bg-[#f6f4ef] text-slate-600"
                  }`}
                >
                  {name} (
                  {products.filter((item) => item.category === name).length})
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, item number, or batch"
              className="mt-4 w-full max-w-md rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
            <p className="mt-3 text-xs text-slate-500">
              {filtered.length} shown
              {products.some((item) => item.stockStatus === "out_of_stock")
                ? ` · ${products.filter((item) => item.stockStatus === "out_of_stock").length} out of stock`
                : ""}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs tracking-wide text-slate-500 uppercase">
                    <th className="py-2 pr-3 font-medium">Photo</th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    {showCategory ? (
                      <th className="py-2 pr-3 font-medium">Category</th>
                    ) : null}
                    {showItemNumber ? (
                      <th className="py-2 pr-3 font-medium">Item no.</th>
                    ) : null}
                    {showBatch ? (
                      <th className="py-2 pr-3 font-medium">Batch</th>
                    ) : null}
                    {showVariant ? (
                      <th className="py-2 pr-3 font-medium">Variant</th>
                    ) : null}
                    {extraKeys.map((key) => (
                      <th key={key} className="py-2 pr-3 font-medium">
                        {key}
                      </th>
                    ))}
                    <th className="py-2 pr-3 font-medium">Price</th>
                    <th className="py-2 font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => (
                    <tr key={product.id} className="border-b border-stone-100">
                      <td className="py-2.5 pr-3">
                        {productImages(product).length ? (
                          <ProductImagePreview
                            images={productImages(product)}
                            alt={product.name}
                            caption={
                              product.variant
                                ? `${product.name} · ${product.variant}`
                                : product.name
                            }
                            thumbClassName="h-12 w-12 rounded-md object-cover"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {product.name}
                        {product.origin === "manual" ? (
                          <span className="ml-2 rounded-full bg-[#163532]/10 px-2 py-0.5 text-[10px] font-medium text-[#163532]">
                            Manual
                          </span>
                        ) : null}
                      </td>
                      {showCategory ? (
                        <td className="py-2.5 pr-3 text-slate-500">
                          {product.category || "—"}
                        </td>
                      ) : null}
                      {showItemNumber ? (
                        <td className="py-2.5 pr-3 font-mono text-xs">
                          {product.itemNumber || "—"}
                        </td>
                      ) : null}
                      {showBatch ? (
                        <td className="py-2.5 pr-3 font-mono text-xs">
                          {product.batchNumber || "—"}
                        </td>
                      ) : null}
                      {showVariant ? (
                        <td className="py-2.5 pr-3 text-slate-500">
                          {product.variant || "—"}
                        </td>
                      ) : null}
                      {extraKeys.map((key) => (
                        <td key={key} className="py-2.5 pr-3 text-slate-500">
                          {product.extras?.[key] || "—"}
                        </td>
                      ))}
                      <td className="py-2.5 pr-3">{product.price || "—"}</td>
                      <td className="py-2.5">
                        <span
                          className={
                            product.stockStatus === "in_stock"
                              ? "text-emerald-700"
                              : product.stockStatus === "out_of_stock"
                                ? "text-red-600"
                                : product.stockStatus === "coming_soon"
                                  ? "text-blue-700"
                                  : "text-slate-500"
                          }
                        >
                          {stockLabel(product.stockStatus)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {showAdd ? (
        <AddProductModal
          categories={categories}
          onClose={() => setShowAdd(false)}
          onSaved={applyCatalog}
        />
      ) : null}
    </div>
  );
}
