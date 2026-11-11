export const BASE_PATH = "/interview";

export function apiUrl(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  return `${BASE_PATH}/${clean}`;
}
