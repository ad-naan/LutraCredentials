import { logError } from '@/lib/logger'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { getAllPlatforms, getPlatform } from '@/platforms/registry'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/platform'
import { AddMethodSelector } from '@/components/accounts/AddMethodSelector'

export function AddAccountDialog() {
  const [open, setOpen] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const { t } = useTranslation()
  const { addAccount, loadAllAccounts } = usePlatformStore()
  const platforms = getAllPlatforms()
  const platform = selectedPlatform ? getPlatform(selectedPlatform) : null
  const methods = platform?.addMethods || []

  useEffect(() => {
    if (open && !selectedPlatform && platforms.length > 0) {
      setSelectedPlatform(platforms[0].id)
    }
  }, [open, selectedPlatform, platforms])

  useEffect(() => {
    if (open && !selectedMethod && methods.length > 0) {
      setSelectedMethod(methods[0].id)
    }
  }, [open, methods, selectedMethod])

  const handlePlatformChange = (platformId: string) => {
    setSelectedPlatform(platformId)
    setSelectedMethod(null)
  }

  const handleSuccess = async (account: Account) => {
    await addAccount(account)
    await loadAllAccounts()
  }

  const handleError = (error: string) => logError('Add account error:', error)
  const handleClose = () => {
    setOpen(false)
    setSelectedMethod(null)
    setSelectedPlatform(null)
  }
  const method = methods.find((item) => item.id === selectedMethod)
  const MethodComponent = method?.component

  return (
    <Dialog open={open} onOpenChange={(value) => value ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        <Button><Plus aria-hidden="true" />{t('accounts.add')}</Button>
      </DialogTrigger>
      <DialogContent className="flex flex-col sm:max-w-[640px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('dialog.addAccount')}</DialogTitle>
          <DialogDescription>{t('workbench.addDescription')}</DialogDescription>
        </DialogHeader>
        <div className="lutra-dialog-body">
          <section className="lutra-dialog-section">
            <h3 className="lutra-dialog-section-label">{t('workbench.choosePlatform')}</h3>
            <div className="add-platform-selector">
              {platforms.map((item) => {
                const Icon = item.icon
                const isActive = selectedPlatform === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handlePlatformChange(item.id)}
                    className={cn('add-platform-option', isActive && 'add-platform-option--active')}
                  >
                    <Icon aria-hidden="true" /><span>{item.name}</span>
                  </button>
                )
              })}
            </div>
          </section>
          {platform && (
            <section className="lutra-dialog-section">
              <h3 className="lutra-dialog-section-label">{t('workbench.chooseMethod')}</h3>
              <AddMethodSelector methods={methods} selectedId={selectedMethod} onSelect={setSelectedMethod} />
            </section>
          )}
          {MethodComponent && selectedPlatform ? (
            <MethodComponent
              key={`${selectedPlatform}:${selectedMethod}`}
              platform={selectedPlatform}
              onSuccess={handleSuccess}
              onError={handleError}
              onClose={handleClose}
            />
          ) : <p className="text-sm text-muted-foreground">{t('dialog.selectMethod')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
