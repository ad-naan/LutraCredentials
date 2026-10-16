import { PlatformConfig } from '@/types/platform'
import { Globe, Key, Database } from 'lucide-react'
import { antigravityIcon } from '@/platforms/icons'
import { AntigravityAccountList } from './components/AccountList'
import { OAuthMethod, TokenMethod, ImportMethod } from './methods'
import { antigravityAccountOps } from './accountOps'

export const antigravityConfig: PlatformConfig = {
  id: 'antigravity',
  name: 'Antigravity',
  icon: antigravityIcon,
  color: '#FF6B35',
  description: 'Google/Anthropic AI Services Management',

  AccountList: AntigravityAccountList,

  features: {
    oauth: true,
    quota: true,
    proxy: true,
    autoRefresh: true,
  },

  accountOps: antigravityAccountOps,

  addMethods: [
    {
      id: 'oauth',
      name: 'OAuth',
      description: 'Google 授权登录',
      icon: Globe,
      component: OAuthMethod,
    },
    {
      id: 'token',
      name: 'Token',
      description: '粘贴刷新令牌',
      icon: Key,
      component: TokenMethod,
    },
    {
      id: 'import',
      name: '导入',
      description: '从数据库导入',
      icon: Database,
      component: ImportMethod,
    },
  ],
}

