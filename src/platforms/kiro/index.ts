import { PlatformConfig } from '@/types/platform'
import { Fingerprint, Users, Key } from 'lucide-react'
import { kiroIcon } from '@/platforms/icons'
import { KiroAccountList } from './components/AccountList'
import { BuilderIdMethod, SocialMethod, TokenImportMethod } from './methods'
import { kiroAccountOps } from './accountOps'

export const kiroConfig: PlatformConfig = {
  id: 'kiro',
  name: 'Kiro IDE',
  icon: kiroIcon,
  color: '#4F46E5',
  description: 'Kiro IDE Account Management',

  AccountList: KiroAccountList,

  features: {
    machineId: true,
    autoRefresh: true,
    quota: true,
  },

  accountOps: kiroAccountOps,

  addMethods: [
    {
      id: 'builderid',
      name: 'Builder ID',
      description: 'AWS Builder ID 登录',
      icon: Fingerprint,
      component: BuilderIdMethod,
    },
    {
      id: 'social',
      name: '社交登录',
      description: 'Google / GitHub',
      icon: Users,
      component: SocialMethod,
    },
    {
      id: 'token',
      name: 'Token 导入',
      description: 'SSO / OIDC 凭证',
      icon: Key,
      component: TokenImportMethod,
    },
  ],
}

