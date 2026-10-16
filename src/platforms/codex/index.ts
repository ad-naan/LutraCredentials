import { PlatformConfig } from '@/types/platform'
import { Terminal, FileJson, KeyRound } from 'lucide-react'
import { CodexAccountList } from './components/AccountList'
import { JsonMethod } from './methods/JsonMethod'
import { OAuthMethod } from './methods/OAuthMethod'

export const codexConfig: PlatformConfig = {
  id: 'codex',
  name: 'Codex',
  icon: Terminal,
  color: '#10A37F',
  description: 'OpenAI Codex API Account Management',

  AccountList: CodexAccountList,

  features: {
    machineId: false,
    autoRefresh: false,
    quota: true,
  },

  addMethods: [
    {
      id: 'oauth',
      name: 'ChatGPT OAuth 登录',
      description: '使用 ChatGPT 账号（Plus/Pro/Team）授权登录',
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
