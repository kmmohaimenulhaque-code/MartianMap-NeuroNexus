/* Mean brightness temperature and sample count in one Ls column (all local times). */
export function columnStats(heatmap, col) {
  if (col == null || !heatmap?.mean_k?.length) return null;
  let sum = 0;
  let n = 0;
  let cells = 0;
  heatmap.mean_k.forEach((row, r) => {
    const v = row[col];
    const k = heatmap.counts?.[r]?.[col] ?? 0;
    if (v != null && k > 0) {
      sum += v * k;
      n += k;
      cells += 1;
    }
  });
  return n ? { meanK: sum / n, n, cells } : { meanK: null, n: 0, cells: 0 };
}
