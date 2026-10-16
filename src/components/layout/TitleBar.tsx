import { X, Minus, Square } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Button } from '@/components/ui/button'

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function TitleBar() {
  // In a plain browser (vite dev preview), the Tauri window API is unavailable.
  const appWindow = isTauriRuntime() ? getCurrentWindow() : null

  const handleMinimize = () => appWindow?.minimize()
  const handleMaximize = () => appWindow?.toggleMaximize()
  const handleClose = () => appWindow?.close()

  return (
    <div
      className="app-titlebar"
      data-tauri-drag-region
    >
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src="/logo.png" alt="" aria-hidden="true" />
        <div className="titlebar-brand-text" data-tauri-drag-region>
          <span className="titlebar-name" data-tauri-drag-region>LutraCredentials</span>
          <span className="titlebar-caption" data-tauri-drag-region>AI ACCOUNT VAULT</span>
        </div>
      </div>
      {/* Window Controls (Windows Style but minimal) */}
      <div className="flex items-center gap-1">
        <Button
          onClick={handleMinimize}
          aria-label="Minimize"
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-muted text-muted-foreground hover:text-foreground rounded-none"
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <Button
          onClick={handleMaximize}
          aria-label="Maximize / restore"
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-muted text-muted-foreground hover:text-foreground rounded-none"
        >
          <Square className="w-3.5 h-3.5" />
        </Button>
        <Button
          onClick={handleClose}
          aria-label="Close window"
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground text-muted-foreground rounded-none"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}
