import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

/** Envelope written to disk; it never contains the passphrase or the plaintext. */
export interface EncryptedSecrets {
  readonly format: 'fudo-secrets-v1'
  readonly kdf: {
    readonly name: 'scrypt'
    readonly n: number
    readonly r: number
    readonly p: number
    readonly salt: string
  }
  readonly iv: string
  readonly tag: string
  readonly data: string
}

const N = 1 << 15
const R = 8
const P = 1
const KEY_BYTES = 32
const IV_BYTES = 12
const SALT_BYTES = 16
const TAG_BYTES = 16

const derive = (passphrase: string, salt: Buffer): Buffer =>
  scryptSync(passphrase, salt, KEY_BYTES, { N, r: R, p: P, maxmem: 128 * N * R * 2 })

export const encryptSecrets = (plaintext: string, passphrase: string): EncryptedSecrets => {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt), iv, {
    authTagLength: TAG_BYTES,
  })
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    format: 'fudo-secrets-v1',
    kdf: { name: 'scrypt', n: N, r: R, p: P, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

/** Returns undefined when the passphrase is wrong or the file was altered. */
export const decryptSecrets = (
  envelope: EncryptedSecrets,
  passphrase: string,
): string | undefined => {
  if (envelope.format !== 'fudo-secrets-v1' || envelope.kdf.name !== 'scrypt') return undefined
  const salt = Buffer.from(envelope.kdf.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    return undefined
  try {
    const key = scryptSync(passphrase, salt, KEY_BYTES, {
      N: envelope.kdf.n,
      r: envelope.kdf.r,
      p: envelope.kdf.p,
      maxmem: 128 * envelope.kdf.n * envelope.kdf.r * 2,
    })
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return undefined
  }
}

/** Constant time comparison, for checking a passphrase against a stored hash. */
export const sameBytes = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The text as an envelope, when the file holds one. */
export const parseEnvelope = (text: string): EncryptedSecrets | undefined => {
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedSecrets>
    return parsed.format === 'fudo-secrets-v1' ? (parsed as EncryptedSecrets) : undefined
  } catch {
    return undefined
  }
}
