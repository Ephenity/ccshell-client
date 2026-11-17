import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'

export function encryptPassword(password: string, publicKeyPem: string, kid: string): string {
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)

  const wrappedKey = publicEncrypt(
    {
      key: normalizePem(publicKeyPem),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
      oaepLabel: Buffer.from('password-v2')
    },
    aesKey
  )

  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  cipher.setAAD(Buffer.from(`password-v2:${kid}`))
  const sealed = Buffer.concat([cipher.update(password, 'utf8'), cipher.final(), cipher.getAuthTag()])

  return `v2.${wrappedKey.toString('base64')}.${iv.toString('base64')}.${sealed.toString('base64')}`
}

function normalizePem(key: string): string {
  if (key.includes('-----BEGIN')) return key
  const body = key.replace(/\s/g, '').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`
}
