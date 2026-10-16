import { PlatformConfig } from '@/types/platform'
import { FileJson, KeyRound } from 'lucide-react'
import { claudeIcon } from '@/platforms/icons'
import { ClaudeAccountList } from './components/AccountList'
import { JsonMethod, OAuthMethod } from './methods'

export const claudeConfig: PlatformConfig = {
  id: 'claude',
  name: 'Claude',
  icon: claudeIcon,
  color: '#4F46E5',
  description: 'Claude API Account Management',

  AccountList: ClaudeAccountList,

  features: {
    machineId: false,
    autoRefresh: false,
    quota: true,
  },

  addMethods: [
    {
      id: 'oauth',
      name: '官方 OAuth 登录',
      description: '使用 Claude 订阅账号（Pro/Max）授权登录',
      icon: KeyRound,
      component: OAuthMethod,
    },
    {
      id: 'json',
      name: 'JSON 导入',
      description: '从 JSON 文件导入账户信息',
      icon: FileJson,
      component: JsonMethod,
    },
  ],
}


