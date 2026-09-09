/** Compare release version ids: "2.1.266", "rust-v0.153.4", "v1.0.13". */
export function compareVersionIds(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function versionParts(v: string): number[] {
  return v
    .replace(/^rust-v/i, "")
    .replace(/^v/i, "")
    .split(/[^0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => Number.parseInt(p, 10));
}
