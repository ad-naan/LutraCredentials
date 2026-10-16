import { invoke } from '@tauri-apps/api/core'
import { useDeferredValue, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Edit,
  ExternalLink,
  FileJson,
  HardDriveDownload,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AccountCard } from '@/components/accounts/AccountCardBase'
import { AddMethodSelector } from '@/components/accounts/AddMethodSelector'
import {
  AccountDetailsDialog,
  DetailGrid,
  DetailRow,
} from '@/components/accounts/AccountDetailsDialogBase'
import { AccountSearch } from '@/components/accounts/AccountSearch'
import { AccountTable, type AccountTableAction } from '@/components/accounts/AccountTable'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'
import { cn } from '@/lib/utils'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { GenericAccount } from '@/types/account'
import type { AddMethodConfig, AddMethodProps, PlatformConfig } from '@/types/platform'

type ViewMode = 'grid' | 'list'
type Status = 'idle' | 'waiting' | 'processing' | 'success' | 'error'

export interface ExternalPlatformDefinition {
  id: string
  name: string
  description: string
  color: string
  icon: LucideIcon
  accountTypeLabel?: string
  importHint?: string
  placeholderJson?: string
  importLocalCommand?: string
  switchCommand?: string
  refreshCommand?: string
  oauthStartCommand?: string
  oauthCompleteCommand?: string
  oauthCancelCommand?: string
  oauthSubmitCallbackCommand?: string
  localImportLabel?: string
  localImportDescription?: string
  supportsTokenImport?: boolean
  tokenImportCommand?: string
  tokenLabel?: string
  tokenPlaceholder?: string
  customAccountActions?: ExternalPlatformAccountActionDefinition[]
}

export interface ExternalPlatformAccountActionDefinition {
  id: string
  label: string
  icon: LucideIcon
  command: string
  kind?: 'checkin'
  statusCommand?: string
  successMessage?: string
}

interface ExternalAccountFormProps {
  definition: ExternalPlatformDefinition
  initialAccount?: GenericAccount | null
  submitLabel: string
  onSubmit: (account: GenericAccount) => Promise<void> | void
  onSuccess?: () => void
}

interface ExternalMethodDialogProps {
  definition: ExternalPlatformDefinition
  methods: AddMethodConfig[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (account: GenericAccount) => Promise<void>
}

const defaultPlaceholderJson = `{
  "accessToken": "your-token",
  "refreshToken": "optional-refresh-token",
  "profile": {
    "email": "name@example.com"
  }
}`

function ensureObjectConfig(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON must be an object')
  }

  return value as Record<string, any>
}

function parseJsonSafely(value: string): Record<string, any> {
  return ensureObjectConfig(JSON.parse(value))
}

function pickText(candidates: unknown[]): string {
  const match = candidates.find((value) => typeof value === 'string' && value.trim())
  return typeof match === 'string' ? match.trim() : ''
}

function extractSuggestedEmail(config?: Record<string, any>): string {
  return pickText([
    config?.email,
    config?.username,
    config?.login,
    config?.githubLogin,
    config?.user?.email,
    config?.user?.login,
    config?.profile?.email,
    config?.account?.email,
    config?.account?.label,
    config?.session?.account?.label,
  ])
}

function extractSuggestedName(config?: Record<string, any>): string {
  return pickText([
    config?.name,
    config?.displayName,
    config?.githubName,
    config?.user?.name,
    config?.profile?.name,
    config?.profile?.displayName,
    config?.account?.name,
    config?.session?.account?.label,
  ])
}

function extractSuggestedProviderId(config?: Record<string, any>): string {
  return pickText([
    config?.providerId,
    config?.type,
    config?.membershipType,
    config?.stripeMembershipType,
    config?.subscriptionType,
    config?.plan,
    config?.tier,
  ])
}

function prettyConfig(value?: Record<string, any>): string {
  return JSON.stringify(value || {}, null, 2)
}

function buildExternalAccount(params: {
  definition: ExternalPlatformDefinition
  config: Record<string, any>
  initialAccount?: GenericAccount | null
  email?: string
  name?: string
  providerId?: string
  notes?: string
  source?: string
}): GenericAccount {
  const {
    definition,
    config,
    initialAccount = null,
    email,
    name,
    providerId,
    notes,
    source,
  } = params

  const resolvedEmail = (email || '').trim() || extractSuggestedEmail(config)
  if (!resolvedEmail) {
    throw new Error(`${definition.name} account identity not found`)
  }

  return {
    id: initialAccount?.id || crypto.randomUUID(),
    platform: definition.id,
    email: resolvedEmail,
    name: (name || '').trim() || extractSuggestedName(config) || definition.name,
    isActive: initialAccount?.isActive || false,
    lastUsedAt: initialAccount?.lastUsedAt || Date.now(),
    createdAt: initialAccount?.createdAt || Date.now(),
    providerId:
      (providerId || '').trim() ||
      extractSuggestedProviderId(config) ||
      definition.accountTypeLabel ||
      undefined,
    config,
    notes: notes?.trim() || initialAccount?.notes || undefined,
    source: source || initialAccount?.source || 'json',
  }
}

function buildExternalAccountPatch(
  account: GenericAccount,
  nextConfig: Record<string, any>,
): Partial<GenericAccount> {
  return {
    email: extractSuggestedEmail(nextConfig) || account.email,
    name: extractSuggestedName(nextConfig) || account.name,
    providerId: extractSuggestedProviderId(nextConfig) || account.providerId,
    config: {
      ...(account.config || {}),
      ...nextConfig,
    },
    lastUsedAt: Date.now(),
  }
}

interface ExternalCheckinStatus {
  today_checked_in: boolean
  active: boolean
  streak_days: number
  daily_credit: number
  today_credit?: number
  next_streak_day?: number
  is_streak_day?: boolean
  checkin_dates?: string[]
}

interface ExternalCheckinResponse {
  success: boolean
  message?: string
  reward?: unknown
  next_checkin_in?: number
}

interface ExternalOAuthStartResponse {
  login_id: string
  verification_uri: string
  verification_uri_complete?: string | null
  expires_in?: number
  interval_seconds?: number
  callback_url?: string | null
}

function ExternalAccountForm({
  definition,
  initialAccount = null,
  submitLabel,
  onSubmit,
  onSuccess,
}: ExternalAccountFormProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(initialAccount?.email || '')
  const [name, setName] = useState(initialAccount?.name || '')
  const [providerId, setProviderId] = useState(initialAccount?.providerId || '')
  const [notes, setNotes] = useState(initialAccount?.notes || '')
  const [rawJson, setRawJson] = useState(
    initialAccount?.config
      ? prettyConfig(initialAccount.config)
      : definition.placeholderJson || defaultPlaceholderJson,
  )
  const [jsonError, setJsonError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const parsed = parseJsonSafely(await file.text())
      setRawJson(JSON.stringify(parsed, null, 2))
      setJsonError('')

      if (!email.trim()) setEmail(extractSuggestedEmail(parsed))
      if (!name.trim()) setName(extractSuggestedName(parsed))
      if (!providerId.trim()) setProviderId(extractSuggestedProviderId(parsed))
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : t('external.invalidJsonFile'))
    } finally {
      event.target.value = ''
    }
  }

  const handleSubmit = async () => {
    setStatus('processing')
    setMessage('')

    try {
      const parsed = parseJsonSafely(rawJson)
      const nextAccount = buildExternalAccount({
        definition,
        config: parsed,
        initialAccount,
        email,
        name,
        providerId,
        notes,
      })

      await onSubmit(nextAccount)
      setJsonError('')
      setStatus('success')
      setMessage(
        initialAccount
          ? t('common.success', { defaultValue: 'Saved successfully' })
          : t('accounts.addSuccess', { defaultValue: 'Account added successfully' }),
      )
      onSuccess?.()
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t('external.saveFailed'))
      if (error instanceof SyntaxError) {
        setJsonError(error.message)
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <p className="text-sm font-medium">{definition.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {definition.importHint || definition.description}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-email`}>
            {t('common.email', { defaultValue: 'Email' })}{' '}
            <span className="text-red-500">*</span>
          </Label>
          <Input
            id={`${definition.id}-email`}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            disabled={status === 'processing'}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-name`}>
            {t('common.name', { defaultValue: 'Name' })}
          </Label>
          <Input
            id={`${definition.id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={definition.name}
            disabled={status === 'processing'}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-provider`}>
            {t('common.type', { defaultValue: 'Type' })}
          </Label>
          <Input
            id={`${definition.id}-provider`}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder={definition.accountTypeLabel || 'Imported'}
            disabled={status === 'processing'}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-notes`}>
            {t('common.details', { defaultValue: 'Notes' })}
          </Label>
          <Input
            id={`${definition.id}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('common.details', { defaultValue: 'Notes' })}
            disabled={status === 'processing'}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Label htmlFor={`${definition.id}-json`}>
            JSON <span className="text-red-500">*</span>
          </Label>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={status === 'processing'}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import File
            </Button>
          </div>
        </div>

        <Textarea
          id={`${definition.id}-json`}
          value={rawJson}
          onChange={(event) => setRawJson(event.target.value)}
          className="min-h-[240px] resize-y font-mono text-xs"
          placeholder={definition.placeholderJson || defaultPlaceholderJson}
          disabled={status === 'processing'}
        />

        {jsonError && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">
            {jsonError}
          </div>
        )}
      </div>

      {message && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
            status === 'success' && 'bg-green-500/10 text-green-600',
            status === 'error' && 'bg-red-500/10 text-red-600',
            status === 'processing' && 'bg-blue-500/10 text-blue-600',
          )}
        >
          {status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
          {status === 'success' && <CheckCircle2 className="h-4 w-4" />}
          <span>{message}</span>
        </div>
      )}

      <Button className="w-full" onClick={handleSubmit} disabled={status === 'processing'}>
        {status === 'processing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  )
}

function createExternalJsonMethod(definition: ExternalPlatformDefinition) {
  return function ExternalJsonMethod(props: AddMethodProps) {
    const { t } = useTranslation()

    return (
      <ExternalAccountForm
        definition={definition}
        submitLabel={t('accounts.add', { defaultValue: 'Add Account' })}
        onSubmit={async (account) => {
          props.onSuccess(account)
          props.onClose()
        }}
      />
    )
  }
}

function createExternalLocalImportMethod(definition: ExternalPlatformDefinition) {
  return function ExternalLocalImportMethod(props: AddMethodProps) {
    const { t } = useTranslation()
    const [status, setStatus] = useState<Status>('idle')
    const [message, setMessage] = useState('')

    const handleImport = async () => {
      if (!definition.importLocalCommand || status === 'processing') return

      setStatus('processing')
      setMessage('')

      try {
        const config = ensureObjectConfig(
          await invoke<Record<string, any>>(definition.importLocalCommand),
        )
        const account = buildExternalAccount({
          definition,
          config,
          source: 'local',
        })

        props.onSuccess(account)
        setStatus('success')
        setMessage(`${definition.name} local account imported`)
        props.onClose()
      } catch (error) {
        setStatus('error')
        setMessage(
          error instanceof Error
            ? error.message
            : `Failed to import ${definition.name} local account`,
        )
      }
    }

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 sm:p-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {definition.localImportLabel || `Import current ${definition.name} account`}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {definition.localImportDescription ||
                `Read the current ${definition.name} login state from this machine and save it into Lutra.`}
            </p>
          </div>
        </div>

        {message && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              status === 'success' && 'bg-green-500/10 text-green-600',
              status === 'error' && 'bg-red-500/10 text-red-600',
              status === 'processing' && 'bg-blue-500/10 text-blue-600',
            )}
          >
            {status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-4 w-4" />}
            <span>{message}</span>
          </div>
        )}

        <Button className="w-full" onClick={handleImport} disabled={status === 'processing'}>
          {status === 'processing' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <HardDriveDownload className="mr-2 h-4 w-4" />
          )}
          {t('common.import', { defaultValue: 'Import' })}
        </Button>
      </div>
    )
  }
}

function createExternalTokenMethod(definition: ExternalPlatformDefinition) {
  return function ExternalTokenMethod(props: AddMethodProps) {
    const [status, setStatus] = useState<Status>('idle')
    const [message, setMessage] = useState('')
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [providerId, setProviderId] = useState(definition.accountTypeLabel || '')
    const [token, setToken] = useState('')
    const canResolveToken = Boolean(definition.tokenImportCommand)

    const handleSubmit = async () => {
      const trimmedEmail = email.trim()
      const trimmedToken = token.trim()

      if (!trimmedToken || (!trimmedEmail && !canResolveToken)) {
        setStatus('error')
        setMessage(canResolveToken ? 'Token is required' : 'Email and token are required')
        return
      }

      setStatus('processing')
      setMessage('')

      try {
        let resolvedConfig: Record<string, any> = {
          email: trimmedEmail || undefined,
          name: name.trim() || undefined,
          providerId: providerId.trim() || definition.accountTypeLabel || undefined,
          accessToken: trimmedToken,
          tokenType: 'Bearer',
        }

        if (definition.tokenImportCommand) {
          resolvedConfig = ensureObjectConfig(
            await invoke(definition.tokenImportCommand, {
              settings: JSON.stringify(resolvedConfig),
            }),
          )
        }

        const account = buildExternalAccount({
          definition,
          email: trimmedEmail,
          name,
          providerId,
          source: 'token',
          config: resolvedConfig,
        })

        props.onSuccess(account)
        setStatus('success')
        setMessage(`${definition.name} token imported`)
        props.onClose()
      } catch (error) {
        setStatus('error')
        setMessage(
          error instanceof Error ? error.message : `Failed to import ${definition.name} token`,
        )
      }
    }

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 sm:p-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Import by Token</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {canResolveToken
                ? `Paste a ${definition.name} access token and let Lutra resolve the account metadata automatically.`
                : `Add a ${definition.name} account from an access token and keep it switchable in Lutra.`}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${definition.id}-token-email`}>
              Email {!canResolveToken && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id={`${definition.id}-token-email`}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={canResolveToken ? 'Optional if token can resolve profile' : 'name@example.com'}
              disabled={status === 'processing'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${definition.id}-token-name`}>Name</Label>
            <Input
              id={`${definition.id}-token-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={definition.name}
              disabled={status === 'processing'}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-token-provider`}>Type</Label>
          <Input
            id={`${definition.id}-token-provider`}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder={definition.accountTypeLabel || definition.name}
            disabled={status === 'processing'}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${definition.id}-token-value`}>
            {definition.tokenLabel || 'Access Token'} <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id={`${definition.id}-token-value`}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="min-h-[160px] resize-y font-mono text-xs"
            placeholder={definition.tokenPlaceholder || 'Paste access token'}
            disabled={status === 'processing'}
          />
        </div>

        {message && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              status === 'success' && 'bg-green-500/10 text-green-600',
              status === 'error' && 'bg-red-500/10 text-red-600',
              status === 'processing' && 'bg-blue-500/10 text-blue-600',
            )}
          >
            {status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-4 w-4" />}
            <span>{message}</span>
          </div>
        )}

        <Button className="w-full" onClick={handleSubmit} disabled={status === 'processing'}>
          {status === 'processing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Import Token
        </Button>
      </div>
    )
  }
}

function createExternalOAuthMethod(definition: ExternalPlatformDefinition) {
  return function ExternalOAuthMethod(props: AddMethodProps) {
    const [status, setStatus] = useState<Status>('idle')
    const [message, setMessage] = useState('')
    const [oauthSession, setOauthSession] = useState<ExternalOAuthStartResponse | null>(null)
    const [callbackUrl, setCallbackUrl] = useState('')

    const handleStart = async () => {
      if (!definition.oauthStartCommand) return

      setStatus('processing')
      setMessage('')

      try {
        const session = await invoke<ExternalOAuthStartResponse>(definition.oauthStartCommand)
        setOauthSession(session)
        setStatus('waiting')

        const targetUrl =
          session.verification_uri_complete || session.verification_uri || session.callback_url || ''
        if (targetUrl) {
          try {
            await openUrl(targetUrl)
          } catch {
            window.open(targetUrl, '_blank', 'noopener,noreferrer')
          }
        }

        setMessage(`Please complete ${definition.name} authorization in the browser.`)
      } catch (error) {
        setStatus('error')
        setMessage(error instanceof Error ? error.message : `Failed to start ${definition.name} OAuth`)
      }
    }

    const handleComplete = async () => {
      if (!definition.oauthCompleteCommand || !oauthSession?.login_id) return

      setStatus('processing')
      setMessage('')

      try {
        const config = ensureObjectConfig(
          await invoke(definition.oauthCompleteCommand, {
            loginId: oauthSession.login_id,
          }),
        )

        const account = buildExternalAccount({
          definition,
          config,
          source: 'oauth',
        })

        props.onSuccess(account)
        setStatus('success')
        setMessage(`${definition.name} account authorized`)
        props.onClose()
      } catch (error) {
        setStatus('error')
        setMessage(
          error instanceof Error ? error.message : `Failed to complete ${definition.name} OAuth`,
        )
      }
    }

    const handleCancel = async () => {
      try {
        if (definition.oauthCancelCommand && oauthSession?.login_id) {
          await invoke(definition.oauthCancelCommand, {
            loginId: oauthSession.login_id,
          })
        }
      } catch {
        // Ignore cancel errors so the dialog can still recover.
      }

      setOauthSession(null)
      setCallbackUrl('')
      setStatus('idle')
      setMessage('')
    }

    const handleSubmitCallback = async () => {
      if (!definition.oauthSubmitCallbackCommand || !oauthSession?.login_id || !callbackUrl.trim()) {
        return
      }

      setStatus('processing')
      setMessage('')

      try {
        await invoke(definition.oauthSubmitCallbackCommand, {
          loginId: oauthSession.login_id,
          callbackUrl: callbackUrl.trim(),
        })
        setStatus('waiting')
        setMessage('Callback submitted. You can now complete authorization.')
      } catch (error) {
        setStatus('error')
        setMessage(
          error instanceof Error ? error.message : `Failed to submit ${definition.name} callback`,
        )
      }
    }

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 sm:p-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold">OAuth Authorization</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Sign in through the official {definition.name} authorization flow and import the
              resulting account into Lutra.
            </p>
          </div>
        </div>

        {!oauthSession ? (
          <Button className="w-full" onClick={handleStart} disabled={status === 'processing'}>
            {status === 'processing' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            Start OAuth
          </Button>
        ) : (
          <div className="space-y-4 rounded-2xl border border-border/60 bg-background/70 p-4">
            <div className="space-y-2">
              <Label>Authorization Link</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={oauthSession.verification_uri_complete || oauthSession.verification_uri}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const targetUrl =
                      oauthSession.verification_uri_complete || oauthSession.verification_uri
                    try {
                      await openUrl(targetUrl)
                    } catch {
                      window.open(targetUrl, '_blank', 'noopener,noreferrer')
                    }
                  }}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open
                </Button>
              </div>
            </div>

            {oauthSession.callback_url && definition.oauthSubmitCallbackCommand && (
              <div className="space-y-2">
                <Label>Manual Callback URL</Label>
                <Input
                  value={callbackUrl}
                  onChange={(event) => setCallbackUrl(event.target.value)}
                  placeholder={oauthSession.callback_url}
                  className="font-mono text-xs"
                  disabled={status === 'processing'}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSubmitCallback}
                  disabled={!callbackUrl.trim() || status === 'processing'}
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Submit Callback
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={handleComplete} disabled={status === 'processing'}>
                {status === 'processing' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Complete Authorization
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={status === 'processing'}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {message && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              status === 'success' && 'bg-green-500/10 text-green-600',
              status === 'error' && 'bg-red-500/10 text-red-600',
              (status === 'waiting' || status === 'processing') && 'bg-blue-500/10 text-blue-600',
            )}
          >
            {status === 'processing' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-4 w-4" />}
            <span>{message}</span>
          </div>
        )}
      </div>
    )
  }
}

function createExternalAddMethods(definition: ExternalPlatformDefinition): AddMethodConfig[] {
  const methods: AddMethodConfig[] = []

  if (definition.oauthStartCommand && definition.oauthCompleteCommand && definition.oauthCancelCommand) {
    methods.push({
      id: 'oauth',
      name: 'OAuth 授权',
      description: `Authorize ${definition.name} in the browser and import the account automatically.`,
      icon: ExternalLink,
      component: createExternalOAuthMethod(definition),
    })
  }

  if (definition.importLocalCommand) {
    methods.push({
      id: 'import',
      name: '本机导入',
      description:
        definition.localImportDescription ||
        `Import the current ${definition.name} session from local state storage.`,
      icon: HardDriveDownload,
      component: createExternalLocalImportMethod(definition),
    })
  }

  if (definition.supportsTokenImport) {
    methods.push({
      id: 'token',
      name: 'Token 导入',
      description: `Import ${definition.name} by access token and keep the account switchable.`,
      icon: Download,
      component: createExternalTokenMethod(definition),
    })
  }

  methods.push({
    id: 'json',
    name: 'JSON 导入',
    description: definition.importHint || definition.description,
    icon: FileJson,
    component: createExternalJsonMethod(definition),
  })

  return methods
}

function ExternalAccountEditorDialog({
  account,
  definition,
  open,
  onClose,
}: {
  account: GenericAccount | null
  definition: ExternalPlatformDefinition
  open: boolean
  onClose: () => void
}) {
  const updateAccount = usePlatformStore((state) => state.updateAccount)
  const loadAllAccounts = usePlatformStore((state) => state.loadAllAccounts)
  const { t } = useTranslation()

  if (!account) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>
            {t('common.edit', { defaultValue: 'Edit' })} {definition.name}
          </DialogTitle>
        </DialogHeader>

        <ExternalAccountForm
          definition={definition}
          initialAccount={account}
          submitLabel={t('common.save', { defaultValue: 'Save' })}
          onSubmit={async (nextAccount) => {
            await updateAccount(account.id, nextAccount)
            await loadAllAccounts()
          }}
          onSuccess={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

function ExternalAccountDetailsDialog({
  account,
  definition,
  open,
  onClose,
}: {
  account: GenericAccount
  definition: ExternalPlatformDefinition
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <AccountDetailsDialog
      open={open}
      onClose={onClose}
      title={account.name || definition.name}
      subtitle={account.email}
      badges={
        <>
          <Badge variant="outline">{definition.name}</Badge>
          {account.providerId && <Badge variant="secondary">{account.providerId}</Badge>}
          {account.source && <Badge variant="secondary">{account.source}</Badge>}
        </>
      }
      sections={[
        {
          title: t('common.details', { defaultValue: 'Details' }),
          icon: <Info className="h-4 w-4 text-muted-foreground" />,
          content: (
            <DetailGrid columns={2}>
              <DetailRow
                label={t('common.email', { defaultValue: 'Email' })}
                value={account.email}
                copyable
              />
              <DetailRow
                label={t('common.name', { defaultValue: 'Name' })}
                value={account.name || '-'}
              />
              <DetailRow
                label={t('common.type', { defaultValue: 'Type' })}
                value={account.providerId || 'Imported'}
              />
              <DetailRow
                label={t('common.status', { defaultValue: 'Status' })}
                value={account.isActive ? 'Active' : 'Inactive'}
              />
              <DetailRow
                label={t('common.createdAt', { defaultValue: 'Created' })}
                value={new Date(account.createdAt).toLocaleString()}
              />
              <DetailRow
                label={t('common.lastUsed', { defaultValue: 'Last Used' })}
                value={new Date(account.lastUsedAt).toLocaleString()}
              />
            </DetailGrid>
          ),
        },
        {
          title: 'JSON',
          icon: <FileJson className="h-4 w-4 text-muted-foreground" />,
          content: (
            <pre className="max-h-[320px] overflow-auto rounded-lg border border-border/60 bg-muted/30 p-4 text-xs leading-6">
              <code>{prettyConfig(account.config)}</code>
            </pre>
          ),
        },
      ]}
    />
  )
}

function ExternalAccountCard({
  account,
  definition,
  onEdit,
  onExport,
  onSwitch,
  onRefresh,
  customActions = [],
  isSwitching = false,
  isRefreshing = false,
}: {
  account: GenericAccount
  definition: ExternalPlatformDefinition
  onEdit: (account: GenericAccount) => void
  onExport: (account: GenericAccount) => void
  onSwitch?: (account: GenericAccount) => void
  onRefresh?: (account: GenericAccount) => void
  customActions?: {
    icon: LucideIcon
    label: string
    onClick: () => void | Promise<void>
    disabled?: boolean
    loading?: boolean
  }[]
  isSwitching?: boolean
  isRefreshing?: boolean
}) {
  const { t } = useTranslation()
  const deleteAccount = usePlatformStore((state) => state.deleteAccount)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <AccountCard
        id={account.id}
        email={account.email}
        name={account.name}
        isActive={account.isActive}
        onSwitch={onSwitch ? () => onSwitch(account) : undefined}
        onRefresh={onRefresh ? () => onRefresh(account) : undefined}
        isSwitching={isSwitching}
        isRefreshing={isRefreshing}
        badges={
          <>
            <Badge variant="outline" className="text-[10px]">
              {definition.name}
            </Badge>
            {account.providerId && (
              <Badge variant="secondary" className="text-[10px]">
                {account.providerId}
              </Badge>
            )}
          </>
        }
        content={
          <div className="space-y-2 text-xs text-muted-foreground">
            {account.notes && <p className="line-clamp-2">{account.notes}</p>}
            <p className="truncate">Updated {new Date(account.lastUsedAt).toLocaleString()}</p>
          </div>
        }
        onExport={() => onExport(account)}
        onDetails={() => setDetailsOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        customActions={[
          ...customActions,
          {
            icon: Edit,
            label: t('common.edit', { defaultValue: 'Edit' }),
            onClick: () => onEdit(account),
          },
        ]}
      />

      <ExternalAccountDetailsDialog
        account={account}
        definition={definition}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('common.delete', { defaultValue: 'Delete' })}
        description={t('common.confirmDelete', {
          name: account.email,
          defaultValue: `Delete ${account.email}?`,
        })}
        confirmText={t('common.delete', { defaultValue: 'Delete' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        variant="destructive"
        onConfirm={async () => {
          await deleteAccount(account.id)
          toast.success(t('common.deleteSuccess', { defaultValue: 'Account deleted' }))
        }}
      />
    </>
  )
}

function ExternalMethodDialog({
  definition,
  methods,
  open,
  onOpenChange,
  onSuccess,
}: ExternalMethodDialogProps) {
  const { t } = useTranslation()
  const [selectedMethod, setSelectedMethod] = useState<string | null>(methods[0]?.id || null)

  const handleClose = () => {
    onOpenChange(false)
    setTimeout(() => setSelectedMethod(methods[0]?.id || null), 150)
  }

  const method = methods.find((item) => item.id === selectedMethod) || methods[0]
  const MethodComponent = method?.component

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {t('accounts.add', { defaultValue: 'Add Account' })} {definition.name}
          </DialogTitle>
        </DialogHeader>

        {methods.length > 1 && (
          <AddMethodSelector methods={methods} selectedId={selectedMethod} onSelect={setSelectedMethod} />
        )}

        {MethodComponent ? (
          <MethodComponent
            platform={definition.id}
            onSuccess={(account) => void onSuccess(account as GenericAccount)}
            onError={(error) => toast.error(error)}
            onClose={handleClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ExternalAddAccountDialog({ definition }: { definition: ExternalPlatformDefinition }) {
  const accounts = usePlatformStore((state) => state.accounts)
  const addAccount = usePlatformStore((state) => state.addAccount)
  const updateAccount = usePlatformStore((state) => state.updateAccount)
  const loadAllAccounts = usePlatformStore((state) => state.loadAllAccounts)
  const platformAccounts = useMemo(
    () =>
      accounts.filter(
        (account): account is GenericAccount => account.platform === definition.id,
      ),
    [accounts, definition.id],
  )
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const methods = useMemo(() => createExternalAddMethods(definition), [definition])

  const handleSuccess = async (account: GenericAccount) => {
    const existingAccount = platformAccounts.find(
      (item) => item.email.toLowerCase() === account.email.toLowerCase(),
    )

    if (account.source === 'local') {
      await Promise.all(
        platformAccounts
          .filter((item) => item.isActive && item.id !== (existingAccount?.id || account.id))
          .map((item) => updateAccount(item.id, { isActive: false })),
      )
    }

    const nextAccountBase =
      account.source === 'local'
        ? { ...account, isActive: true, lastUsedAt: Date.now() }
        : account

    const nextAccount = existingAccount
      ? { ...nextAccountBase, id: existingAccount.id, createdAt: existingAccount.createdAt }
      : nextAccountBase

    if (existingAccount) {
      await updateAccount(existingAccount.id, nextAccount)
    } else {
      await addAccount(nextAccount)
    }

    await loadAllAccounts()
    setOpen(false)
  }

  return (
    <>
      <Button variant="default" className="shadow-sm" onClick={() => setOpen(true)}>
        <FileJson className="mr-2 h-4 w-4" />
        {t('accounts.add', { defaultValue: 'Add Account' })}
      </Button>

      <ExternalMethodDialog
        definition={definition}
        methods={methods}
        open={open}
        onOpenChange={setOpen}
        onSuccess={handleSuccess}
      />
    </>
  )
}

function ExternalPlatformAccountList({ definition }: { definition: ExternalPlatformDefinition }) {
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const updateAccount = usePlatformStore((state) => state.updateAccount)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportAccounts, setExportAccounts] = useState<GenericAccount[] | null>(null)
  const [editAccount, setEditAccount] = useState<GenericAccount | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({})
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const { versions, loading: versionsLoading } = usePlatformVersions()

  const platformAccounts = useMemo(
    () => accounts.filter((account): account is GenericAccount => account.platform === definition.id),
    [accounts, definition.id],
  )

  const methods = useMemo(() => createExternalAddMethods(definition), [definition])

  const filteredAccounts = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return platformAccounts

    return platformAccounts.filter((account) =>
      [account.email, account.name, account.providerId, account.notes].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    )
  }, [deferredSearchQuery, platformAccounts])

  const version = versions.find((item) => item.platform === definition.id)
  const canSwitchAccounts = Boolean(definition.switchCommand)
  const canRefreshAccounts = Boolean(definition.refreshCommand)
  const buildActionKey = (accountId: string, actionId: string) => `${accountId}:${actionId}`
  const isActionLoading = (accountId: string, actionId: string) =>
    Boolean(actionLoadingMap[buildActionKey(accountId, actionId)])

  const handleSwitchAccount = async (account: GenericAccount) => {
    if (!definition.switchCommand || isSwitching) return
    if (!account.config) {
      toast.error(`${definition.name} configuration not found`)
      return
    }

    setIsSwitching(true)

    try {
      await invoke(definition.switchCommand, { settings: JSON.stringify(account.config) })

      await Promise.all(
        platformAccounts
          .filter((item) => item.id !== account.id && item.isActive)
          .map((item) => updateAccount(item.id, { isActive: false })),
      )
      await updateAccount(account.id, { isActive: true, lastUsedAt: Date.now() })

      toast.success(`${definition.name} account switched successfully`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to switch ${definition.name} account`,
      )
    } finally {
      setIsSwitching(false)
    }
  }

  const handleRefreshAccount = async (account: GenericAccount) => {
    if (!definition.refreshCommand || !account.config) {
      toast.error(`${definition.name} configuration not found`)
      return
    }

    const actionKey = buildActionKey(account.id, 'refresh')
    setActionLoadingMap((current) => ({ ...current, [actionKey]: true }))

    try {
      const nextConfig = ensureObjectConfig(
        await invoke(definition.refreshCommand, {
          settings: JSON.stringify(account.config),
        }),
      )

      await updateAccount(account.id, buildExternalAccountPatch(account, nextConfig))
      toast.success(`${definition.name} account refreshed`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to refresh ${definition.name} account`,
      )
    } finally {
      setActionLoadingMap((current) => {
        const next = { ...current }
        delete next[actionKey]
        return next
      })
    }
  }

  const handleCustomAccountAction = async (
    account: GenericAccount,
    action: ExternalPlatformAccountActionDefinition,
  ) => {
    if (!account.config) {
      toast.error(`${definition.name} configuration not found`)
      return
    }

    const actionKey = buildActionKey(account.id, action.id)
    setActionLoadingMap((current) => ({ ...current, [actionKey]: true }))

    try {
      if (action.kind === 'checkin') {
        let latestStatus: ExternalCheckinStatus | undefined

        if (action.statusCommand) {
          try {
            latestStatus = await invoke<ExternalCheckinStatus>(action.statusCommand, {
              settings: JSON.stringify(account.config),
            })
            await updateAccount(account.id, {
              config: {
                ...(account.config || {}),
                checkinStatus: latestStatus,
              },
            })

            if (latestStatus.today_checked_in) {
              toast.success(`${definition.name} 今日已签到`)
              return
            }
          } catch {
            latestStatus = undefined
          }
        }

        const result = await invoke<ExternalCheckinResponse>(action.command, {
          settings: JSON.stringify(account.config),
        })

        if (action.statusCommand) {
          try {
            latestStatus = await invoke<ExternalCheckinStatus>(action.statusCommand, {
              settings: JSON.stringify(account.config),
            })
          } catch {
            latestStatus = latestStatus
          }
        }

        await updateAccount(account.id, {
          config: {
            ...(account.config || {}),
            ...(latestStatus ? { checkinStatus: latestStatus } : {}),
            checkinResult: result,
          },
          lastUsedAt: Date.now(),
        })

        if (result.success) {
          toast.success(result.message || action.successMessage || `${definition.name} 签到成功`)
        } else {
          toast.error(result.message || `${definition.name} 签到失败`)
        }
        return
      }

      await invoke(action.command, {
        settings: JSON.stringify(account.config),
      })
      toast.success(action.successMessage || `${definition.name} action completed`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to run ${action.label} for ${definition.name}`,
      )
    } finally {
      setActionLoadingMap((current) => {
        const next = { ...current }
        delete next[actionKey]
        return next
      })
    }
  }

  const getAccountActions = (account: GenericAccount): AccountTableAction[] =>
    (definition.customAccountActions || []).map((action) => ({
      icon: action.icon,
      label: action.label,
      onClick: () => void handleCustomAccountAction(account, action),
      loading: isActionLoading(account.id, action.id),
      disabled: isActionLoading(account.id, action.id),
      className:
        action.kind === 'checkin'
          ? 'hover:text-emerald-500 hover:bg-emerald-500/10'
          : 'hover:text-primary',
    }))

  return (
    <div className="platform-account-list">
      <div className="platform-list-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="platform-list-title">{definition.name}</h1>
            {versionsLoading ? (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {t('common.loading', { defaultValue: 'Loading...' })}
              </span>
            ) : version ? (
              version.installed ? (
                <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  {version.version
                    ? `v${version.version}`
                    : t('common.installed', { defaultValue: 'Installed' })}
                </span>
              ) : (
                <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                  {t('common.notInstalled', { defaultValue: 'Not installed' })}
                </span>
              )
            ) : (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {methods.length > 1 ? t('external.multipleMethods') : 'JSON'}
              </span>
            )}
          </div>
          <p className="platform-list-description">
            {definition.description}
          </p>
        </div>

        <div className="platform-list-actions">
          {platformAccounts.length > 0 && (
            <>
              <AccountSearch
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={filteredAccounts.length}
                className="account-search"
              />
              <div className="view-switcher">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-7 px-2"
                  title={t('common.gridView')}
                  aria-label={t('common.gridView')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-7 px-2"
                  title={t('common.listView')}
                  aria-label={t('common.listView')}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setExportAccounts(null)
                  setExportOpen(true)
                }}
                className="toolbar-export"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('common.export', { defaultValue: 'Export' })}
              </Button>
            </>
          )}
          <ExternalAddAccountDialog definition={definition} />
        </div>
      </div>

      {platformAccounts.length === 0 ? (
        <Card className="account-empty-state">
          <CardContent className="account-empty-content">
            <div className="account-empty-icon">
              <definition.icon aria-hidden="true" />
            </div>
            <p className="empty-title">
              {t('accounts.noAccounts', { defaultValue: 'No accounts yet' })}
            </p>
            <p className="empty-description">
              {definition.importHint || definition.description}
            </p>
            <ExternalAddAccountDialog definition={definition} />
          </CardContent>
        </Card>
      ) : filteredAccounts.length === 0 ? (
        <Card className="account-empty-state">
          <CardContent className="account-empty-content">
            <Search className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="empty-title">
              {t('common.noResults', { defaultValue: 'No results found' })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('common.tryDifferentSearch', { defaultValue: 'Try a different search term' })}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="account-grid">
          {filteredAccounts.map((account) => (
            <ExternalAccountCard
              key={account.id}
              account={account}
              definition={definition}
              onEdit={setEditAccount}
              onExport={(currentAccount) => {
                setExportAccounts([currentAccount])
                setExportOpen(true)
              }}
              onSwitch={canSwitchAccounts ? handleSwitchAccount : undefined}
              onRefresh={canRefreshAccounts ? handleRefreshAccount : undefined}
              customActions={getAccountActions(account)}
              isSwitching={isSwitching}
              isRefreshing={isActionLoading(account.id, 'refresh')}
            />
          ))}
        </div>
      ) : (
        <AccountTable
          accounts={filteredAccounts}
          onSwitch={canSwitchAccounts ? handleSwitchAccount : undefined}
          onRefresh={canRefreshAccounts ? handleRefreshAccount : undefined}
          onEdit={(account) => setEditAccount(account as GenericAccount)}
          getCustomActions={(account) => getAccountActions(account as GenericAccount)}
          isSwitching={isSwitching}
        />
      )}

      <ExternalAccountEditorDialog
        account={editAccount}
        definition={definition}
        open={Boolean(editAccount)}
        onClose={() => setEditAccount(null)}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false)
          setExportAccounts(null)
        }}
        accounts={exportAccounts || platformAccounts}
      />
    </div>
  )
}

export function createExternalPlatformConfig(
  definition: ExternalPlatformDefinition,
): PlatformConfig {
  const AccountList = () => <ExternalPlatformAccountList definition={definition} />

  return {
    id: definition.id,
    name: definition.name,
    icon: definition.icon,
    color: definition.color,
    description: definition.description,
    AccountList,
    features: {
      quota: false,
      autoRefresh: false,
      machineId: false,
    },
    addMethods: createExternalAddMethods(definition),
  }
}
