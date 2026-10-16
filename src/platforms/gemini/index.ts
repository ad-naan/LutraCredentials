import { PlatformConfig } from '@/types/platform'
import { FileJson } from 'lucide-react'
import { geminiIcon } from '@/platforms/icons'
import { GeminiAccountList } from './components/AccountList'
import { JsonMethod } from './methods/JsonMethod'

export const geminiConfig: PlatformConfig = {
  id: 'gemini',
  name: 'Gemini',
  icon: geminiIcon,
  color: '#4285F4',
  description: 'Google Gemini API Account Management',

  AccountList: GeminiAccountList,

  features: {
    machineId: false,
    autoRefresh: false,
    quota: false,
  },

  addMethods: [
    {
      id: 'json',
      name: 'JSON 导入',
      description: '从 JSON 文件导入账户信息',
      icon: FileJson,
      component: JsonMethod,
    }
  ],
}
