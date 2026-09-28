import { Stats } from "@/app/lib/api";

export default function AnalyticsCharts({ stats }: { stats: Stats | null }) {
  const totalProducts = stats?.totalProducts ?? 0;
  const inStock = stats?.inStock ?? 0;
  const soldOut = stats?.soldOut ?? 0;
  const upcoming = stats?.upcoming ?? 0;
  const maxDaily = Math.max(...(stats?.daily ?? []).map((item) => item.chats), 1);
  const stockSlices = [
    { label: "In stock", value: inStock, color: "#0f766e" },
    { label: "Sold out", value: soldOut, color: "#b45309" },
    { label: "Upcoming", value: upcoming, color: "#1d4ed8" },
  ];
  const mix = [
    { label: "Leads", value: stats?.totalLeads ?? 0, color: "#163532" },
    { label: "Unanswered", value: stats?.unanswered ?? 0, color: "#b45309" },
    { label: "Chats", value: stats?.totalChats ?? 0, color: "#3f6f68" },
    { label: "Products", value: totalProducts, color: "#9db5af" },
  ];
  const mixMax = Math.max(...mix.map((item) => item.value), 1);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-slate-500">
        Live snapshot of leads, catalog stock, and chatbot volume.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Leads" value={stats?.totalLeads ?? 0} />
        <StatCard label="Total products" value={totalProducts} />
        <StatCard label="In stock" value={inStock} />
        <StatCard label="Sold out" value={soldOut} />
        <StatCard label="Upcoming" value={upcoming} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Catalog mix</h2>
          <p className="mt-1 text-xs text-slate-500">
            In stock, sold out, and upcoming items.
          </p>
          <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
            <Donut slices={stockSlices} total={totalProducts} />
            <div className="space-y-3 text-sm">
              {stockSlices.map((slice) => (
                <div key={slice.label} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: slice.color }}
                  />
                  <span className="text-slate-600">{slice.label}</span>
                  <span className="ml-auto font-medium">{slice.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Business pulse</h2>
          <p className="mt-1 text-xs text-slate-500">
            Leads, unanswered questions, chats, and catalog size.
          </p>
          <div className="mt-6 space-y-4">
            {mix.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex text-xs text-slate-500">
                  <span>{item.label}</span>
                  <span className="ml-auto font-medium text-slate-800">{item.value}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[#f6f4ef]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max((item.value / mixMax) * 100, item.value ? 6 : 0)}%`,
                      background: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Chats this week</h2>
        <div className="mt-6 flex h-52 items-end gap-3">
          {(stats?.daily ?? []).map((item) => (
            <div key={item.date} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-40 w-full items-end rounded-md bg-[#f6f4ef]">
                <div
                  className="w-full rounded-md bg-[#163532] transition-all duration-700"
                  style={{
                    height: `${Math.max((item.chats / maxDaily) * 100, item.chats ? 10 : 3)}%`,
                  }}
                />
              </div>
              <span className="text-[11px] text-slate-500">{item.date.slice(5)}</span>
              <span className="text-[11px] font-medium text-slate-700">{item.chats}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function Donut({
  slices,
  total,
}: {
  slices: { label: string; value: number; color: string }[];
  total: number;
}) {
  const size = 148;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const safeTotal = total || slices.reduce((sum, item) => sum + item.value, 0) || 1;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#f6f4ef"
        strokeWidth={stroke}
      />
      {slices.map((slice) => {
        const length = (slice.value / safeTotal) * circumference;
        const circle = (
          <circle
            key={slice.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={stroke}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += length;
        return circle;
      })}
    </svg>
  );
}
