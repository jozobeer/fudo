/** Profile shipped with the default bundle. Rows are resolved by the kernel loader. */
export const baseProfileUrl = new URL('../profiles/base.yml', import.meta.url)

export async function loadBundledProfile(url: URL = baseProfileUrl): Promise<string> {
  return Bun.file(url).text()
}
