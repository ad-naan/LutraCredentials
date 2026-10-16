/**
 * Claude 添加/修改对话框
 *
 * 添加方式由平台注册中心（addMethods）统一驱动
 */

import { logError } from '@/lib/logger'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { getPlatform } from '@/platforms/registry'
import { AddMethodSelector } from '@/components/accounts/AddMethodSelector'
import type { Account } from '@/types/platform'

export function AddAccountDialog() {
    const [open, setOpen] = useState(false)
    const [selectedMethod, setSelectedMethod] = useState<string | null>('oauth')
    const { t } = useTranslation()
    const { addAccount, loadAllAccounts } = usePlatformStore()

    const platformId = 'claude'
    const platform = getPlatform(platformId)
    const methods = platform?.addMethods || []

    // 添加成功回调
    const handleSuccess = async (account: Account) => {
        await addAccount(account)
        await loadAllAccounts()
    }

    // 添加失败回调
    const handleError = (error: string) => {
        logError('Add account error:', error)
    }

    // 关闭对话框
    const handleClose = () => {
        setOpen(false)
        setSelectedMethod(null)
    }

    // 渲染添加方式选择器
    const renderMethodSelector = () => (
        <AddMethodSelector methods={methods} selectedId={selectedMethod} onSelect={setSelectedMethod} />
    )

    // 渲染选中的添加方式组件
    const renderMethodContent = () => {
        if (!selectedMethod) {
            return (
                <div className="text-center py-8 text-muted-foreground text-sm">
                    {t('dialog.selectMethod', '请选择添加方式')}
                </div>
            )
        }

        const method = methods.find(m => m.id === selectedMethod)
        if (!method) return null

        const MethodComponent = method.component

        return (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                <MethodComponent
                    platform={platformId}
                    onSuccess={handleSuccess}
                    onError={handleError}
                    onClose={handleClose}
                />
            </div>
        )
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelectedMethod(null) } }}>
            <DialogTrigger asChild>
                <Button variant="default" className="shadow-sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('accounts.add')}
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.addAccount')} - Claude
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        选择一种方式添加 Claude 账号
                    </DialogDescription>
                </DialogHeader>

                {/* 添加方式选择 */}
                <div>
                    {renderMethodSelector()}
                </div>

                {/* 添加方式内容 */}
                <div className="min-h-0">
                    {renderMethodContent()}
                </div>
            </DialogContent>
        </Dialog>
    )
}
