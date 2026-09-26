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

export type VersionBump = "major" | "minor" | "patch" | "unknown";

/**
 * Classify how `current` moves from `previous`.
 * Unknown when either side has no numeric parts, they are equal, or previous is missing.
 */
export function versionBumpKind(current: string, previous: string | null | undefined): VersionBump {
  if (!previous) return "unknown";
  const pa = versionParts(previous);
  const pb = versionParts(current);
  if (!pa.length || !pb.length) return "unknown";
  if (compareVersionIds(current, previous) === 0) return "unknown";
  const n = Math.max(pa.length, pb.length);
  const a = Array.from({ length: n }, (_, i) => pa[i] ?? 0);
  const b = Array.from({ length: n }, (_, i) => pb[i] ?? 0);
  if (a[0] !== b[0]) return "major";
  // Classic x.y.z: y bump is minor. Two-part builds (e.g. Codex App 26.908) treat the
  // trailing component as a patch/build id so hourly noise can coalesce.
  if (n >= 3 && a[1] !== b[1]) return "minor";
  return "patch";
}

function versionParts(v: string): number[] {
  return v
    .replace(/^rust-v/i, "")
    .replace(/^v/i, "")
    .split(/[^0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => Number.parseInt(p, 10));
}
