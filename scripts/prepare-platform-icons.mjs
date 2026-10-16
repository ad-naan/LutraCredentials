/**
 * Builds the real brand icons used by the platform registry.
 *
 * Sources are the official marks taken from the reference implementations in
 * `same-other/`. Everything is flattened to a 128px rounded tile PNG so the UI
 * renders one consistent, theme-safe brand icon per platform.
 *
 * Usage: node scripts/prepare-platform-icons.mjs
 */
import path from 'node:path'
import { rename, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import sharp from 'sharp'

const directory = path.resolve('src/assets/platform-icons')
const size = 128
const padding = 16
const radius = 28

/** App icons: padded exports that keep their own tile; trimmed, then corner-masked. */
const appIcons = [
  ['antigravity.svg', 'antigravity.png'],
  ['cursor.svg', 'cursor.png'],
  ['windsurf.svg', 'windsurf.png'],
  ['codebuddy.png', 'codebuddy.png'],
  ['qoder.png', 'qoder.png'],
  ['trae.png', 'trae.png'],
  ['zed.png', 'zed.png'],
  ['workbuddy.png', 'workbuddy.png'],
  ['zcode.png', 'zcode.png'],
]

/** Transparent vector marks: rasterized onto a light tile so they read in both themes. */
const vectorMarks = [
  ['claude.svg', 'claude.png'],
  ['codex.svg', 'codex.png'],
  ['copilot.svg', 'copilot.png'],
  ['gemini.svg', 'gemini.png'],
  ['grok.svg', 'grok.png'],
  ['kiro.svg', 'kiro.png'],
]

const tile = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`,
)

const kb = async (file) => `${Math.round((await stat(file)).size / 1024)} KB`

async function write(target, pipeline) {
  const temporary = `${target}.tmp`
  await pipeline.png({ compressionLevel: 9 }).toFile(temporary)
  await rm(target, { force: true })
  await rename(temporary, target)
}

for (const [sourceName, targetName] of appIcons) {
  const target = path.join(directory, targetName)
  // Vector wrappers are already flattened on the first run; reuse the PNG then.
  const source = existsSync(path.join(directory, sourceName))
    ? path.join(directory, sourceName)
    : target
  const before = await kb(source)


  let trimmed = source
  const temporaryTrim = path.join(directory, `${targetName}.trim.png`)
  try {
    await sharp(source, { density: 384 }).trim({ threshold: 12 }).png().toFile(temporaryTrim)
    trimmed = temporaryTrim
  } catch {
    trimmed = source
  }

  await write(
    target,
    sharp(trimmed)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: '#ffffff' })
      .composite([{ input: tile, blend: 'dest-in' }]),
  )

  await rm(temporaryTrim, { force: true })
  if (trimmed !== target && source !== target) await rm(source, { force: true })
  console.log(`${sourceName} -> ${targetName} (${before} -> ${await kb(target)})`)
}

for (const [sourceName, targetName] of vectorMarks) {
  const source = path.join(directory, sourceName)
  const target = path.join(directory, targetName)
  const before = await kb(source)
  const inner = size - padding * 2

  const glyph = await sharp(source, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  await write(
    target,
    sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
      .composite([
        { input: glyph, top: padding, left: padding },
        { input: tile, blend: 'dest-in' },
      ]),
  )

  console.log(`${sourceName} -> ${targetName} (${before} -> ${await kb(target)})`)
}
