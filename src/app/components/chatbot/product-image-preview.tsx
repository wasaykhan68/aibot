"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ProductImagePreview({
  src,
  images,
  alt,
  caption,
  thumbClassName = "h-10 w-10 rounded-md object-cover",
}: {
  src?: string;
  images?: string[];
  alt: string;
  caption?: string;
  thumbClassName?: string;
}) {
  const gallery = (images && images.length ? images : src ? [src] : []).filter(Boolean);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const closeTimer = useRef<number>(0);
  const pinned = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [gallery.join("|")]);

  function keepOpen() {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function scheduleClose() {
    if (pinned.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
  }

  function closePreview() {
    pinned.current = false;
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  }

  function show(next: number) {
    if (!gallery.length) return;
    setIndex((next + gallery.length) % gallery.length);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
      if (event.key === "Escape") closePreview();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, gallery.length]);

  if (!gallery.length) return null;
  const current = gallery[index] || gallery[0];

  return (
    <>
      <button
        type="button"
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        onFocus={keepOpen}
        onClick={() => {
          pinned.current = true;
          keepOpen();
        }}
        className="group relative block overflow-hidden rounded-md outline-none"
        aria-label={`Preview ${alt}`}
      >
        <img
          src={gallery[0]}
          alt={alt}
          className={`${thumbClassName} transition duration-300 group-hover:scale-110`}
        />
        {gallery.length > 1 ? (
          <span className="absolute right-1 bottom-1 rounded bg-black/65 px-1 text-[10px] font-medium text-white">
            {gallery.length}
          </span>
        ) : null}
      </button>
      {mounted && open
        ? createPortal(
            <div
              className="product-preview-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-[#041513]/55 p-6 backdrop-blur-md"
              onMouseEnter={keepOpen}
              onMouseLeave={scheduleClose}
              onClick={closePreview}
            >
              <div
                className="product-preview-pop relative flex max-h-[86vh] max-w-[min(880px,92vw)] flex-col items-center"
                onClick={(event) => event.stopPropagation()}
                onMouseEnter={keepOpen}
              >
                <button
                  type="button"
                  onClick={closePreview}
                  className="absolute -top-3 -right-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white text-2xl leading-none text-[#163532] shadow-lg"
                  aria-label="Close preview"
                >
                  ×
                </button>
                <div className="relative overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(4,21,19,0.45)] ring-1 ring-white/70">
                  <img
                    src={current}
                    alt={alt}
                    className="max-h-[72vh] max-w-[min(880px,92vw)] object-contain"
                  />
                  {gallery.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => show(index - 1)}
                        className="absolute top-1/2 left-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-[#163532] text-xl text-white shadow-lg"
                        aria-label="Previous image"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => show(index + 1)}
                        className="absolute top-1/2 right-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-[#163532] text-xl text-white shadow-lg"
                        aria-label="Next image"
                      >
                        ›
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="product-preview-caption mt-4 max-w-lg text-center text-sm font-medium text-white drop-shadow">
                  {caption || alt}
                  {gallery.length > 1 ? ` · ${index + 1}/${gallery.length}` : ""}
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
