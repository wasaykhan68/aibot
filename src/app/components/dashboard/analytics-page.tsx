"use client";

import { useEffect, useState } from "react";
import { api, Stats } from "@/app/lib/api";
import AnalyticsCharts from "@/app/components/dashboard/analytics-charts";

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>("/api/stats")
      .then(setStats)
      .catch(() => {
        setStats(null);
      });
  }, []);

  return <AnalyticsCharts stats={stats} />;
}
