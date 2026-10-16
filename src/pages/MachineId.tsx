/**
 * 机器码管理页面
 * 
 * 功能：
 * - 查看当前系统机器码
 * - 生成新的机器码
 * - 查看所有账号的机器码绑定记录
 * - 管理账号与机器码的绑定关系
 */

import { logError } from '@/lib/logger'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'
import { MachineIdService } from '@/services/MachineIdService'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { 
  Fingerprint, 
  RefreshCw, 
  Copy, 
  Check, 
  Link, 
  Unlink,
  AlertCircle,
  Info
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'

interface MachineIdBinding {
  accountId: string
  accountEmail: string
  accountPlatform: string
  machineId: string
  boundAt?: number
}

export function MachineId() {
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const machineIdService = MachineIdService.getInstance()

  const [currentMachineId, setCurrentMachineId] = useState<string>('')
  const [bindings, setBindings] = useState<MachineIdBinding[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedBinding, setSelectedBinding] = useState<MachineIdBinding | null>(null)
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false)
  const [newMachineId, setNewMachineId] = useState('')
  const [editMode, setEditMode] = useState(false)

  // 加载当前机器码
  const loadCurrentMachineId = async () => {
    try {
      const machineId = await machineIdService.getMachineId()
      setCurrentMachineId(machineId)
    } catch (error) {
      logError('Failed to load machine ID:', error)
    }
  }

  // 加载所有绑定记录
  const loadBindings = async () => {
    try {
      const bindingsMap = await machineIdService.getAllBindings()
      const bindingsList: MachineIdBinding[] = []

      bindingsMap.forEach((machineId, accountId) => {
        const account = accounts.find((acc) => acc.id === accountId)
        if (account) {
          bindingsList.push({
            accountId,
            accountEmail: account.email,
            accountPlatform: account.platform,
            machineId,
          })
        }
      })

      setBindings(bindingsList)
    } catch (error) {
      logError('Failed to load bindings:', error)
    }
  }

  // 初始化加载
  useEffect(() => {
    loadCurrentMachineId()
    loadBindings()
  }, [accounts])

  // 生成新机器码
  const handleGenerateMachineId = async () => {
    try {
      const newId = await machineIdService.generateMachineId()
      setNewMachineId(newId)
      setEditMode(true)
    } catch (error) {
      logError('Failed to generate machine ID:', error)
    }
  }

  // 应用新机器码
  const handleApplyMachineId = async () => {
    if (!newMachineId) return

    setLoading(true)
    try {
      await machineIdService.setMachineId(newMachineId)
      setCurrentMachineId(newMachineId)
      setEditMode(false)
      setNewMachineId('')
    } catch (error) {
      logError('Failed to set machine ID:', error)
    } finally {
      setLoading(false)
    }
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditMode(false)
    setNewMachineId('')
  }

  // 复制机器码
  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 解绑机器码
  const handleUnbind = async () => {
    if (!selectedBinding) return

    setLoading(true)
    try {
      await machineIdService.unbindMachineId(selectedBinding.accountId)
      await loadBindings()
      setUnbindDialogOpen(false)
      setSelectedBinding(null)
    } catch (error) {
      logError('Failed to unbind machine ID:', error)
    } finally {
      setLoading(false)
    }
  }

  // 打开解绑对话框
  const openUnbindDialog = (binding: MachineIdBinding) => {
    setSelectedBinding(binding)
    setUnbindDialogOpen(true)
  }

  return (
    <div className="page-stack machine-page">
      {/* 页面标题 */}
      <div>
        <h2 className="page-title">
          {t('machineId.title', 'Machine ID Management')}
        </h2>
        <p className="page-description">
          {t('machineId.description', 'Manage device identifiers and account bindings')}
        </p>
      </div>

      {/* 提示信息 */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('machineId.infoTitle', 'What is Machine ID?')}</AlertTitle>
        <AlertDescription>
          {t('machineId.infoDescription', 'Machine ID is a unique device identifier used to prevent account association bans. Each account can be bound to a specific machine ID, and the system will automatically switch machine IDs when switching accounts.')}
        </AlertDescription>
      </Alert>

      {/* 当前机器码 */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            {t('machineId.current', 'Current Machine ID')}
          </CardTitle>
          <CardDescription>
            {t('machineId.currentDescription', 'The machine ID currently in use by the system')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!editMode ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-4 py-3 rounded-lg bg-muted/50 font-mono text-sm border border-border/50">
                  {currentMachineId || t('machineId.loading', 'Loading...')}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(currentMachineId)}
                  disabled={!currentMachineId}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={handleGenerateMachineId}
                className="w-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('machineId.generate', 'Generate New Machine ID')}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="new-machine-id">
                  {t('machineId.newMachineId', 'New Machine ID')}
                </Label>
                <Input
                  id="new-machine-id"
                  value={newMachineId}
                  onChange={(e) => setNewMachineId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono"
                />
              </div>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('machineId.warning', 'Warning')}</AlertTitle>
                <AlertDescription>
                  {t('machineId.warningDescription', 'Changing the machine ID will affect all accounts. Make sure you understand the implications before proceeding.')}
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button
                  onClick={handleApplyMachineId}
                  disabled={!newMachineId || loading}
                  className="flex-1"
                >
                  {loading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                  {t('common.apply', 'Apply')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={loading}
                  className="flex-1"
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 绑定记录 */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            {t('machineId.bindings', 'Account Bindings')}
          </CardTitle>
          <CardDescription>
            {t('machineId.bindingsDescription', 'View and manage machine ID bindings for all accounts')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Fingerprint className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('machineId.noBindings', 'No account bindings yet')}</p>
              <p className="text-sm mt-2">
                {t('machineId.noBindingsHint', 'Bind accounts to machine IDs in account settings')}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('machineId.account', 'Account')}</TableHead>
                    <TableHead>{t('machineId.platform', 'Platform')}</TableHead>
                    <TableHead>{t('machineId.machineId', 'Machine ID')}</TableHead>
                    <TableHead className="text-right">{t('common.actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bindings.map((binding) => (
                    <TableRow key={binding.accountId}>
                      <TableCell className="font-medium">
                        {binding.accountEmail}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {binding.accountPlatform}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted/50 px-2 py-1 rounded">
                          {binding.machineId.substring(0, 8)}...
                        </code>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(binding.machineId)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openUnbindDialog(binding)}
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 解绑确认对话框 */}
      <Dialog open={unbindDialogOpen} onOpenChange={setUnbindDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('machineId.unbindTitle', 'Unbind Machine ID')}</DialogTitle>
            <DialogDescription>
              {t('machineId.unbindDescription', 'Are you sure you want to unbind the machine ID from this account?')}
            </DialogDescription>
          </DialogHeader>
          {selectedBinding && (
            <div className="py-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineId.account', 'Account')}:</span>
                  <span className="font-medium">{selectedBinding.accountEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineId.platform', 'Platform')}:</span>
                  <Badge variant="outline" className="capitalize">
                    {selectedBinding.accountPlatform}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineId.machineId', 'Machine ID')}:</span>
                  <code className="text-xs font-mono">{selectedBinding.machineId.substring(0, 16)}...</code>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUnbindDialogOpen(false)}
              disabled={loading}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnbind}
              disabled={loading}
            >
              {loading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {t('machineId.unbind', 'Unbind')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
