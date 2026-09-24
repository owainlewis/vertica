/** Keep existing carousel and media links working alongside the public homepage. */
export function isStudioLocation(location: { search: string }): boolean {
  const params = new URLSearchParams(location.search);
  return Boolean(params.get("id")) || ["carousels", "media"].includes(params.get("view") ?? "");
}
