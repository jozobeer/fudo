import { describe, expect, test } from 'bun:test'
import { decryptSecrets, encryptSecrets, parseEnvelope } from '../src/index.ts'

describe('encryptSecrets', () => {
  test('round-trips with the right passphrase', () => {
    const envelope = encryptSecrets('OLLAMA_API_KEY=abc\n', 'correct horse')

    expect(decryptSecrets(envelope, 'correct horse')).toBe('OLLAMA_API_KEY=abc\n')
  })

  test('the envelope keeps no plaintext and a fresh salt each time', () => {
    const first = encryptSecrets('OLLAMA_API_KEY=abc', 'pw')
    const second = encryptSecrets('OLLAMA_API_KEY=abc', 'pw')

    expect(JSON.stringify(first)).not.toContain('abc')
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.data).not.toBe(second.data)
  })

  test('a wrong passphrase opens nothing', () => {
    const envelope = encryptSecrets('secret', 'right')

    expect(decryptSecrets(envelope, 'wrong')).toBeUndefined()
  })

  test('altered data opens nothing', () => {
    const envelope = encryptSecrets('secret', 'pw')
    const tampered = { ...envelope, data: Buffer.from('nonsense').toString('base64') }

    expect(decryptSecrets(tampered, 'pw')).toBeUndefined()
  })
})

describe('parseEnvelope', () => {
  test('recognises its own format and nothing else', () => {
    const envelope = encryptSecrets('a=b', 'pw')

    expect(parseEnvelope(JSON.stringify(envelope))?.format).toBe('fudo-secrets-v1')
    expect(parseEnvelope('A=1\n')).toBeUndefined()
    expect(parseEnvelope('{}')).toBeUndefined()
  })
})
