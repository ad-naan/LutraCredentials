import { cn } from '@/lib/utils'
import type { AddMethodConfig } from '@/types/platform'

type MethodOption = Pick<AddMethodConfig, 'id' | 'name' | 'description' | 'icon'>

interface AddMethodSelectorProps {
  methods: MethodOption[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function AddMethodSelector({ methods, selectedId, onSelect }: AddMethodSelectorProps) {
  return (
    <div className="method-selector">
      {methods.map((method) => {
        const Icon = method.icon
        const isActive = method.id === selectedId

        return (
          <button
            key={method.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(method.id)}
            className={cn('method-option', isActive && 'method-option--active')}
          >
            <span className="method-option-heading">
              <span className="method-option-icon"><Icon aria-hidden="true" /></span>
              <span>{method.name}</span>
            </span>
            <span className="method-option-description">{method.description}</span>
          </button>
        )
      })}
    </div>
  )
}
