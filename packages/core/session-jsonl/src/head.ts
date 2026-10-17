import { open } from 'node:fs/promises'

/**
 * The first `maxBytes` of a file, decoded as UTF-8. A shorter file reads whole,
 * and a character the cut splits reads as the replacement character; either way
 * the callers only look for the line endings they can see.
 */
export const readHead = async (path: string, maxBytes: number): Promise<string> => {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
