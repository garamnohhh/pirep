export function htmlAffectedByChanges(htmlPath: string, changedPaths: string[]): boolean {
  const html = htmlPath.split("\\").join("/");
  const folder = html.includes("/") ? html.slice(0, html.lastIndexOf("/")) : "";
  return changedPaths.some((value) => {
    const path = value.split("\\").join("/");
    if (!path || path.startsWith("/") || path.split("/").includes(".pirep") || path.split("/").includes("..")) return false;
    return path === html || (folder ? path.startsWith(`${folder}/`) : !path.startsWith("."));
  });
}
