import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { logError } from '@/lib/logger'
import { Button } from '@/components/ui/button'
import i18n from '@/i18n/config'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 自定义降级 UI；不传时使用内置兜底界面 */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 全局错误边界（P1b 可观测性）
 *
 * 捕获渲染树中的未处理异常，避免整窗白屏；记录错误并提供「重试 / 重载」出口。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('[ErrorBoundary] Uncaught render error:', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="surface flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-base font-semibold text-foreground">
              {i18n.t('errors.boundaryTitle', { defaultValue: '出现了一个错误' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {i18n.t('errors.boundaryDescription', {
                defaultValue: '界面渲染失败，你可以重试或重新加载应用。',
              })}
            </p>
          </div>
          <pre className="w-full overflow-auto rounded-md bg-muted/50 p-3 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              <RotateCcw aria-hidden="true" />
              {i18n.t('common.retry', { defaultValue: '重试' })}
            </Button>
            <Button onClick={this.handleReload}>
              {i18n.t('errors.boundaryReload', { defaultValue: '重新加载' })}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
