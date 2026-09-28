"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, CatalogResponse } from "@/app/lib/api";

export default function AddProductModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: string[];
  onClose: () => void;
  onSaved: (data: CatalogResponse) => void;
}) {
  const [name, setName] = useState("");
  const [categoryMode, setCategoryMode] = useState(categories[0] ? "existing" : "new");
  const [category, setCategory] = useState(categories[0] || "");
  const [newCategory, setNewCategory] = useState("");
  const [itemNumber, setItemNumber] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [variant, setVariant] = useState("");
  const [price, setPrice] = useState("");
  const [stockStatus, setStockStatus] = useState("in_stock");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageUrls, setImageUrls] = useState([""]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const locked = document.querySelectorAll<HTMLElement>("html, body, section");
    const previous = Array.from(locked).map((node) => node.style.overflow);
    locked.forEach((node) => {
      node.style.overflow = "hidden";
    });
    return () => {
      locked.forEach((node, index) => {
        node.style.overflow = previous[index] || "";
      });
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Product name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append(
        "category",
        categoryMode === "new" ? newCategory.trim() : category.trim(),
      );
      form.append("itemNumber", itemNumber.trim());
      form.append("batchNumber", batchNumber.trim());
      form.append("variant", variant.trim());
      form.append("price", price.trim());
      form.append("stockStatus", stockStatus);
      form.append("sourceUrl", sourceUrl.trim());
      form.append(
        "imageUrls",
        JSON.stringify(imageUrls.map((url) => url.trim()).filter(Boolean)),
      );
      if (files) {
        Array.from(files).forEach((file) => form.append("images", file));
      }
      onSaved(await api<CatalogResponse>("/api/products", { method: "POST", body: form }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add product.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex h-[min(40rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="shrink-0 px-5 pt-5">
          <h2 className="text-lg font-semibold">Add product</h2>
          <p className="mt-1 text-sm text-slate-500">
            Fill the catalog fields. Manual products stay after a store sync.
          </p>
        </div>

        <div className="hide-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto px-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Product name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Category</span>
            <select
              value={categoryMode === "new" ? "__new" : category}
              onChange={(event) => {
                if (event.target.value === "__new") {
                  setCategoryMode("new");
                  return;
                }
                setCategoryMode("existing");
                setCategory(event.target.value);
              }}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              <option value="__new">New category...</option>
            </select>
          </label>
          {categoryMode === "new" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">New category</span>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
              />
            </label>
          ) : (
            <div />
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Item no.</span>
            <input
              value={itemNumber}
              onChange={(event) => setItemNumber(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Batch</span>
            <input
              value={batchNumber}
              onChange={(event) => setBatchNumber(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Variant</span>
            <input
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Price</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Stock</span>
            <select
              value={stockStatus}
              onChange={(event) => setStockStatus(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            >
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="coming_soon">Upcoming</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Product page URL</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Images</p>
          <p className="mt-1 text-xs text-slate-500">
            Paste links or upload files. Multiple photos use popup arrows.
          </p>
          <div className="mt-2 space-y-2">
            {imageUrls.map((url, index) => (
              <input
                key={index}
                value={url}
                onChange={(event) =>
                  setImageUrls((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                placeholder="https://..."
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163532]"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setImageUrls((current) => [...current, ""])}
            className="mt-2 text-sm font-medium text-[#163532]"
          >
            + Add another image URL
          </button>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setFiles(event.target.files)}
            className="mt-3 block w-full text-sm"
          />
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-stone-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-600"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#163532] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save product"}
          </button>
        </div>
      </form>
    </div>
  );
}
