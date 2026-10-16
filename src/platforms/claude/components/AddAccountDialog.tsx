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
import { cn } from '@/lib/utils'
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
        <div className="grid grid-cols-2 gap-2">
            {methods.map((method) => {
                const Icon = method.icon
                const isActive = selectedMethod === method.id

                return (
                    <button
                        key={method.id}
                        onClick={() => setSelectedMethod(method.id)}
                        className={cn(
                            "p-4 rounded-xl border transition-all text-left relative overflow-hidden group",
                            isActive
                                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                                : "border-border/60 hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5 bg-card"
                        )}
                    >
                        <div className="flex items-center gap-3 mb-1.5">
                            <div className={cn(
                                "p-2 rounded-lg transition-colors",
                                "bg-muted group-hover:bg-primary/10 group-hover:text-primary",
                                isActive && "bg-primary text-primary-foreground"
                            )}>
                                <Icon className="h-5 w-5" />
                            </div>
                            <span className={cn("text-sm font-semibold", isActive ? "text-primary" : "text-foreground")}>
                                {method.name}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {method.description}
                        </p>
                    </button>
                )
            })}
        </div>
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

            <DialogContent className="sm:max-w-[550px] border-border bg-card text-card-foreground shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">
                        {t('dialog.addAccount')} - Claude
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        选择一种方式添加 Claude 账号
                    </DialogDescription>
                </DialogHeader>

                {/* 添加方式选择 */}
                <div className="mt-4">
                    {renderMethodSelector()}
                </div>

                {/* 添加方式内容 */}
                <div className="mt-4 min-h-[220px]">
                    {renderMethodContent()}
                </div>
            </DialogContent>
        </Dialog>
    )
}
