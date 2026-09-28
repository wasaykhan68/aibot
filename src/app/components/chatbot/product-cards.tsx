import { canTryOnProduct, CatalogProduct, productImages } from "@/app/lib/api";

export default function ProductCards({
  products,
  onTryOn,
}: {
  products?: CatalogProduct[];
  onTryOn?: (product: CatalogProduct) => void;
}) {
  const cards = (products || []).filter((item) => productImages(item).length > 0);
  if (!cards.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {cards.map((product) => {
        const photos = productImages(product);
        return (
        <div
          key={`${product.externalId}-${product.variant}`}
          className="w-[136px] overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_8px_18px_rgba(22,53,50,0.06)]"
        >
          <img
            src={photos[0]}
            alt={product.name}
            className="h-28 w-full object-cover"
          />
          <div className="px-2.5 py-2">
            <p className="line-clamp-2 text-[11px] font-semibold text-[#163532]">
              {product.name}
            </p>
            {product.variant ? (
              <p className="truncate text-[10px] text-slate-500">
                {product.variant}
              </p>
            ) : null}
            {onTryOn && canTryOnProduct(product) ? (
              <button
                type="button"
                onClick={() => onTryOn(product)}
                className="mt-1.5 w-full rounded-lg bg-[#163532] px-2 py-1 text-[10px] font-medium text-white"
              >
                Try on me
              </button>
            ) : null}
          </div>
        </div>
        );
      })}
    </div>
  );
}
