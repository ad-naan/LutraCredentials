import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CirclePlus, Sparkles, Wrench } from 'lucide-react'
import { CHANGELOG, type ChangeKind } from '@/data/changelog'
import packageJson from '../../../package.json'

const KIND_META: Record<ChangeKind, { icon: typeof CirclePlus; className: string }> = {
  added: { icon: CirclePlus, className: 'changelog-kind--added' },
  improved: { icon: Sparkles, className: 'changelog-kind--improved' },
  fixed: { icon: Wrench, className: 'changelog-kind--fixed' },
}

/** Version history board: a scrollable timeline of every release's changes. */
export function ChangelogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('changelog.title')}</DialogTitle>
          <DialogDescription>
            {t('changelog.description', { count: CHANGELOG.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="changelog-board">
          {CHANGELOG.map((entry) => {
            const isCurrent = entry.version === packageJson.version
            return (
              <section key={entry.version} className="changelog-release">
                <header className="changelog-release-head">
                  <span className="changelog-release-dot" aria-hidden="true" />
                  <h3 className="changelog-release-version">v{entry.version}</h3>
                  {isCurrent && (
                    <span className="changelog-release-badge">
                      {t('changelog.current')}
                    </span>
                  )}
                  {entry.date && (
                    <span className="changelog-release-date">{entry.date}</span>
                  )}
                </header>

                <div className="changelog-release-body">
                  {entry.sections.map((section) => {
                    const meta = KIND_META[section.kind]
                    const Icon = meta.icon
                    return (
                      <div key={section.kind} className="changelog-group">
                        <span className={`changelog-kind ${meta.className}`}>
                          <Icon aria-hidden="true" />
                          {t(`changelog.kinds.${section.kind}`)}
                        </span>
                        <ul className="changelog-items">
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
