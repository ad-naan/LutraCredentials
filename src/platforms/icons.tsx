/**
 * Real brand icons for every registered platform.
 *
 * The marks are the official product logos flattened to 128px rounded tiles by
 * `scripts/prepare-platform-icons.mjs`, so the same asset renders correctly in
 * light and dark themes without falling back to generic substitutes.
 */
import type { ComponentProps, ComponentType } from 'react'
import antigravitySource from '@/assets/platform-icons/antigravity.png'
import claudeSource from '@/assets/platform-icons/claude.png'
import codebuddySource from '@/assets/platform-icons/codebuddy.png'
import codexSource from '@/assets/platform-icons/codex.png'
import copilotSource from '@/assets/platform-icons/copilot.png'
import cursorSource from '@/assets/platform-icons/cursor.png'
import geminiSource from '@/assets/platform-icons/gemini.png'
import grokSource from '@/assets/platform-icons/grok.png'
import kiroSource from '@/assets/platform-icons/kiro.png'
import qoderSource from '@/assets/platform-icons/qoder.png'
import traeSource from '@/assets/platform-icons/trae.png'
import windsurfSource from '@/assets/platform-icons/windsurf.png'
import workbuddySource from '@/assets/platform-icons/workbuddy.png'
import zcodeSource from '@/assets/platform-icons/zcode.png'
import zedSource from '@/assets/platform-icons/zed.png'

/**
 * Platform icons are rendered as `<img>` nodes, so they share the DOM props of
 * an image element instead of the props of an icon-font component.
 */
export type PlatformIconComponent = ComponentType<ComponentProps<'img'>>

/** Platform id -> brand asset, also used where only a raw source URL is needed. */
export const platformIconSources: Record<string, string> = {
  antigravity: antigravitySource,
  codex: codexSource,
  'github-copilot': copilotSource,
  windsurf: windsurfSource,
  kiro: kiroSource,
  cursor: cursorSource,
  gemini: geminiSource,
  claude: claudeSource,
  codebuddy: codebuddySource,
  codebuddy_cn: codebuddySource,
  qoder: qoderSource,
  trae: traeSource,
  zed: zedSource,
  workbuddy: workbuddySource,
  grok: grokSource,
  zcode: zcodeSource,
}

function createPlatformIcon(source: string): PlatformIconComponent {
  return function PlatformBrandIcon(props: ComponentProps<'img'>) {
    return <img src={source} alt="" aria-hidden="true" draggable={false} {...props} />
  }
}

export const antigravityIcon = createPlatformIcon(antigravitySource)
export const codexIcon = createPlatformIcon(codexSource)
export const copilotIcon = createPlatformIcon(copilotSource)
export const windsurfIcon = createPlatformIcon(windsurfSource)
export const kiroIcon = createPlatformIcon(kiroSource)
export const cursorIcon = createPlatformIcon(cursorSource)
export const geminiIcon = createPlatformIcon(geminiSource)
export const claudeIcon = createPlatformIcon(claudeSource)
export const codebuddyIcon = createPlatformIcon(codebuddySource)
export const qoderIcon = createPlatformIcon(qoderSource)
export const traeIcon = createPlatformIcon(traeSource)
export const zedIcon = createPlatformIcon(zedSource)
export const workbuddyIcon = createPlatformIcon(workbuddySource)
export const grokIcon = createPlatformIcon(grokSource)
export const zcodeIcon = createPlatformIcon(zcodeSource)
