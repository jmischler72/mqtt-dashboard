function configuredBasePath(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href");
  const fallback = import.meta.env.BASE_URL;
  const pathname = new URL(baseHref ?? fallback, window.location.origin)
    .pathname;
  return pathname === "/" ? "/" : `${pathname.replace(/\/+$/, "")}/`;
}

export const basePath = configuredBasePath();

// appPath keeps browser requests inside the configured application mount.
// Callers may pass the familiar root-relative API paths used before base-path
// support; the result remains root-relative to the deployment, not the host.
export function appPath(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return basePath === "/" ? suffix : `${basePath.slice(0, -1)}${suffix}`;
}
