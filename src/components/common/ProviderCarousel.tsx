/**
 * Provider 紧凑分页选择组件
 * 用于在添加账号时选择供应商
 */

import { useState } from 'react'
import { Check, ExternalLink, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProviderPreset, ProviderCategory } from '@/types/provider'

interface ProviderCarouselProps {
  providers: ProviderPreset[]
  selectedId?: string
  onSelect: (id: string) => void
  isEn?: boolean
}

const categoryLabels: Record<ProviderCategory, { zh: string; en: string }> = {
  official: { zh: '官方', en: 'Official' },
  cn_official: { zh: '国产', en: 'CN' },
  aggregator: { zh: '聚合', en: 'Aggregator' },
  third_party: { zh: '第三方', en: '3rd Party' },
  custom: { zh: '自定义', en: 'Custom' },
}

export function ProviderCarousel({ providers, selectedId, onSelect, isEn = false }: ProviderCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const itemsPerPage = 9
  const totalPages = Math.max(1, Math.ceil(providers.length / itemsPerPage))
  const pageIndex = Math.min(currentIndex, totalPages - 1)
  const currentProviders = providers.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {currentProviders.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isSelected={selectedId === provider.id}
            onSelect={() => onSelect(provider.id)}
            isEn={isEn}
          />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex justify-end gap-1">
          {Array.from({ length: totalPages }, (_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentIndex(index)}
              aria-label={`${isEn ? 'Page' : '第'} ${index + 1}${isEn ? '' : ' 页'}`}
              aria-pressed={index === pageIndex}
              className={cn(
                'h-6 min-w-6 rounded px-1 text-[10px] transition-colors',
                index === pageIndex ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ProviderCardProps {
  provider: ProviderPreset
  isSelected: boolean
  onSelect: () => void
  isEn: boolean
}

function ProviderCard({ provider, isSelected, onSelect, isEn }: ProviderCardProps) {
  const categoryLabel = categoryLabels[provider.category || 'custom']

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      title={provider.name}
      className={cn(
        'flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
        isSelected ? 'border-primary/50 bg-accent/60' : 'border-border bg-card hover:border-primary/40',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{provider.name}</span>
        <span className="block text-[10px] text-muted-foreground">{isEn ? categoryLabel.en : categoryLabel.zh}</span>
      </span>
      {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : (
        provider.isPartner ? <Star className="h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" /> : null
      )}
    </button>
  )
}

interface ProviderInfoProps {
  provider: ProviderPreset
  isEn: boolean
}

export function ProviderInfo({ provider, isEn }: ProviderInfoProps) {
  const categoryLabel = categoryLabels[provider.category || 'custom']

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 rounded-lg border bg-muted/30 space-y-2"
    >
      {/* 头部 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{provider.name}</h3>
            {provider.isPartner && (
              <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {isEn ? categoryLabel.en : categoryLabel.zh}
          </div>
        </div>

        {provider.apiKeyUrl && (
          <a
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
          >
            {isEn ? 'Get Key' : '获取'}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* 描述 */}
      {provider.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {provider.description}
        </p>
      )}

      {/* 网站链接 */}
      {provider.websiteUrl && (
        <a
          href={provider.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {provider.websiteUrl.replace(/^https?:\/\//, '')}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </motion.div>
  )
}
