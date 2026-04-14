export function buildMetricSeries(trend: Array<Record<string, number | string>>, metric: string) {
  return {
    xAxis: {
      type: "category",
      data: trend.map((item) => String(item.date ?? item.created_at ?? "")),
    },
    yAxis: { type: "value", min: 0, max: 1 },
    tooltip: { trigger: "axis" },
    series: [
      {
        type: "line",
        smooth: true,
        data: trend.map((item) => Number(item[metric] ?? 0)),
      },
    ],
  };
}
