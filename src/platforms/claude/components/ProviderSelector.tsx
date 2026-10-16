import { useState } from 'react'
import { ClaudeProviderPreset } from '@/types/provider'
import { claudeProviderPresets } from '../config/presets'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Star } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { claudeProviderService } from '../services/ProviderService'
import { EndpointSpeedTest } from '@/components/common/EndpointSpeedTest'
import { toast } from 'sonner'
import { ExternalLink, Loader2 } from 'lucide-react'

interface ProviderSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ProviderSelector({ open, onOpenChange, onSuccess }: ProviderSelectorProps) {
  const [selectedPreset, setSelectedPreset] = useState<ClaudeProviderPreset | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [selectedBaseUrl, setSelectedBaseUrl] = useState<string | undefined>(undefined)
  const [isApplying, setIsApplying] = useState(false)

  const groupedPresets = {
    official: claudeProviderPresets.filter((p) => p.category === 'official'),
    cn_official: claudeProviderPresets.filter((p) => p.category === 'cn_official'),
    aggregator: claudeProviderPresets.filter((p) => p.category === 'aggregator'),
    custom: claudeProviderPresets.filter((p) => p.category === 'custom'),
  }

  const handlePresetChange = (presetId: string) => {
    const preset = claudeProviderPresets.find((p) => p.id === presetId)
    setSelectedPreset(preset || null)
    setApiKey('')
    setSelectedBaseUrl(preset?.config.env.ANTHROPIC_BASE_URL)
  }

  const handleApply = async () => {
    if (!selectedPreset) {
      toast.error('请选择供应商')
      return
    }

    if (!apiKey.trim()) {
      toast.error('请输入 API Key')
      return
    }

    setIsApplying(true)
    try {
      await claudeProviderService.applyProvider(selectedPreset, apiKey.trim(), selectedBaseUrl)
      toast.success('Provider 配置已应用', {
        description: '请重启 Claude Code 使配置生效',
      })
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      toast.error('应用配置失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>选择 Claude Provider</DialogTitle>
          <DialogDescription>
            选择一个供应商预设并输入 API Key，配置将写入 ~/.claude/settings.json
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>供应商</Label>
            <Select onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                {groupedPresets.official.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>官方</SelectLabel>
                    {groupedPresets.official.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groupedPresets.cn_official.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>国产官方</SelectLabel>
                    {groupedPresets.cn_official.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                        {preset.isPartner && (
                          <Star className="ml-1.5 inline h-3 w-3 text-amber-500" aria-hidden="true" />
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groupedPresets.aggregator.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>聚合平台</SelectLabel>
                    {groupedPresets.aggregator.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groupedPresets.custom.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>自定义</SelectLabel>
                    {groupedPresets.custom.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {selectedPreset && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>API Key</Label>
                  {selectedPreset.apiKeyUrl && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => window.open(selectedPreset.apiKeyUrl, '_blank')}
                    >
                      获取 API Key
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder="输入 API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              {selectedPreset.description && (
                <p className="text-sm text-muted-foreground">{selectedPreset.description}</p>
              )}

              {selectedPreset.endpointCandidates && selectedPreset.endpointCandidates.length > 0 ? (
                <EndpointSpeedTest
                  endpoints={selectedPreset.endpointCandidates}
                  selectedUrl={selectedBaseUrl}
                  onSelect={setSelectedBaseUrl}
                />
              ) : (
                selectedPreset.config.env.ANTHROPIC_BASE_URL && (
                  <div className="rounded-md bg-muted p-3 text-sm">
                    <div className="font-medium">Base URL</div>
                    <div className="text-muted-foreground">
                      {selectedBaseUrl ?? selectedPreset.config.env.ANTHROPIC_BASE_URL}
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleApply} disabled={!selectedPreset || !apiKey.trim() || isApplying}>
            {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            应用配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
