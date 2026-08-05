export const MAX_CLUSTER_ZOOM = 15;

export function shouldClusterAtZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom <= MAX_CLUSTER_ZOOM;
}
