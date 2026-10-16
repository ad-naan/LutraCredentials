import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { Account } from '@/types/account'
import { X, FileJson, FileText, Table, Clipboard, Check, Download } from 'lucide-react'

type ExportFormat = 'json' | 'txt' | 'csv' | 'clipboard'

interface ExportDialogProps {
    open: boolean
    onClose: () => void
    accounts?: Account[]
    selectedIds?: string[]
}

export function ExportDialog({ open, onClose, accounts: propAccounts, selectedIds = [] }: ExportDialogProps) {
    const { i18n } = useTranslation()
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json')
    const [includeCredentials, setIncludeCredentials] = useState(true)
    const [copied, setCopied] = useState(false)
    const storeAccounts = usePlatformStore(state => state.accounts)

    const isEn = i18n.language === 'en'

    // Use passed accounts or filter from store
    const accounts = propAccounts || (selectedIds.length > 0
        ? storeAccounts.filter(a => selectedIds.includes(a.id))
        : storeAccounts)

    if (!open) return null

    const formats: { id: ExportFormat; name: string; icon: typeof FileJson; desc: string }[] = [
        { id: 'json', name: 'JSON', icon: FileJson, desc: isEn ? 'Full data, can be imported' : '完整数据，可用于导入' },
        { id: 'txt', name: 'TXT', icon: FileText, desc: isEn ? 'Text format' : '纯文本格式' },
        { id: 'csv', name: 'CSV', icon: Table, desc: isEn ? 'Excel compatible' : 'Excel 兼容格式' },
        { id: 'clipboard', name: isEn ? 'Clipboard' : '剪贴板', icon: Clipboard, desc: isEn ? 'Copy to clipboard' : '复制到剪贴板' },
    ]

    // Generate export content
    const generateContent = (format: ExportFormat): string => {
        switch (format) {
            case 'json':
                const exportData = {
                    version: '1.0',
                    exportedAt: new Date().toISOString(),
                    accounts: accounts.map(acc => {
                        if (!includeCredentials) {
                            // Remove sensitive fields
                            const { ...rest } = acc
                            if (acc.platform === 'antigravity') {
                                return { ...rest, token: undefined }
                            }
                            return rest
                        }
                        return acc
                    })
                }
                return JSON.stringify(exportData, null, 2)

            case 'txt':
                return accounts.map(acc => {
                    if (includeCredentials && acc.platform === 'antigravity') {
                        const ag = acc as any
                        return [
                            acc.email,
                            ag.token?.refresh_token || '',
                            acc.name || '',
                            'Google'
                        ].join(',')
                    }
                    return `${acc.email}${acc.name ? ` (${acc.name})` : ''}`
                }).join('\n')

            case 'csv':
                const headers = includeCredentials
                    ? ['Email', 'Name', 'Platform', 'RefreshToken']
                    : ['Email', 'Name', 'Platform', 'Status']
                const rows = accounts.map(acc => {
                    if (includeCredentials) {
                        const token = acc.platform === 'antigravity' ? (acc as any).token?.refresh_token || '' : ''
                        return [acc.email, acc.name || '', acc.platform, token]
                    }
                    return [acc.email, acc.name || '', acc.platform, acc.isActive ? 'Active' : 'Inactive']
                })
                // Add BOM for Excel
                return '\ufeff' + [headers, ...rows].map(row =>
                    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
                ).join('\n')

            case 'clipboard':
                return accounts.map(acc =>
                    `${acc.email}${acc.name ? ` (${acc.name})` : ''} - ${acc.platform}`
                ).join('\n')

            default:
                return ''
        }
    }

    // Export handler
    const handleExport = async () => {
        const content = generateContent(selectedFormat)

        if (selectedFormat === 'clipboard') {
            await navigator.clipboard.writeText(content)
            setCopied(true)
            setTimeout(() => {
                setCopied(false)
                onClose()
            }, 1500)
            return
        }

        // Download file
        const extensions: Record<string, string> = {
            json: 'json',
            txt: 'txt',
            csv: 'csv'
        }
        const filename = `lutra-accounts-${new Date().toISOString().slice(0, 10)}.${extensions[selectedFormat]}`
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        onClose()
    }

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative bg-background rounded-xl shadow-2xl w-[450px] animate-in fade-in zoom-in-95 duration-200 border border-border">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        <h2 className="text-lg font-semibold">
                            {isEn ? 'Export Accounts' : '导出账号'}
                        </h2>
                        <Badge variant="secondary">
                            {selectedIds.length > 0
                                ? (isEn ? `${selectedIds.length} selected` : `${selectedIds.length} 个选中`)
                                : (isEn ? `All ${accounts.length}` : `全部 ${accounts.length} 个`)}
                        </Badge>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Format Selection */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        {formats.map(format => {
                            const Icon = format.icon
                            const isSelected = selectedFormat === format.id
                            return (
                                <button
                                    key={format.id}
                                    onClick={() => setSelectedFormat(format.id)}
                                    className={cn(
                                        "p-4 rounded-lg border-2 text-left transition-all",
                                        isSelected
                                            ? "border-primary bg-primary/5"
                                            : "border-muted hover:border-muted-foreground/30"
                                    )}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Icon className={cn("h-4 w-4", isSelected && "text-primary")} />
                                        <span className={cn("font-medium", isSelected && "text-primary")}>
                                            {format.name}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{format.desc}</p>
                                </button>
                            )
                        })}
                    </div>

                    {/* Options */}
                    {selectedFormat === 'json' && (
                        <label className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeCredentials}
                                onChange={(e) => setIncludeCredentials(e.target.checked)}
                                className="w-4 h-4 rounded accent-primary"
                            />
                            <div>
                                <p className="text-sm font-medium">{isEn ? 'Include credentials' : '包含凭证信息'}</p>
                                <p className="text-xs text-muted-foreground">
                                    {isEn ? 'Include tokens for full import' : '包含 Token 等敏感数据，可用于完整导入'}
                                </p>
                            </div>
                        </label>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30 rounded-b-xl">
                    <Button variant="outline" onClick={onClose}>
                        {isEn ? 'Cancel' : '取消'}
                    </Button>
                    <Button onClick={handleExport} disabled={copied}>
                        {copied ? (
                            <>
                                <Check className="h-4 w-4 mr-2" />
                                {isEn ? 'Copied' : '已复制'}
                            </>
                        ) : selectedFormat === 'clipboard' ? (
                            <>
                                <Clipboard className="h-4 w-4 mr-2" />
                                {isEn ? 'Copy' : '复制'}
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4 mr-2" />
                                {isEn ? 'Export' : '导出'}
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    )
}
