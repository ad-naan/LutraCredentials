/**
 * Bundled changelog rendered by the ChangelogDialog board.
 *
 * 维护约定：每次发版前在 CHANGELOG 数组头部添加一条新记录
 * （与 package.json / tauri.conf.json 的 version 同步），用户更新后
 * 即可在「版本号菜单 → 更新日志」和「设置 → 关于」中看到本次更新内容。
 */

export type ChangeKind = 'added' | 'improved' | 'fixed'

export interface ChangelogSection {
  kind: ChangeKind
  items: string[]
}

export interface ChangelogEntry {
  version: string
  /** ISO 日期，未知可留空字符串 */
  date: string
  sections: ChangelogSection[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.0.0',
    date: '2026-10-16',
    sections: [
      {
        kind: 'added',
        items: [
          '新增 Cursor、Windsurf、CodeBuddy、WorkBuddy、Qoder、Trae 等本地平台支持，可一键导入和切换账号',
          '新增 Claude / Codex 官方 OAuth 登录，订阅账号可直接授权导入',
          '新增本地路由代理：HTTP 代理 + 上游故障转移 + 竞速/最低延迟聚合模式',
          '新增 AI 用量统计：请求量、Token 消耗、缓存命中、成本估算与 14 天趋势',
          '新增 API 端点测速，供应商选择时可实时比较延迟',
          '新增数据备份恢复、运行日志查看和凭据自动刷新',
          '新增「数据与路径」独立页面，集中管理数据存储、备份、日志与本地平台路径',
          '右上角版本号可点击：快速检查更新、查看更新日志看板',
          '新增更新日志看板，每次更新后可查看具体变更内容',
        ],
      },
      {
        kind: 'improved',
        items: [
          '全新「岩灰湖绿」视觉设计，界面整体重构，支持浅色/深色主题',
          '项目品牌正式更名为 LutraCredentials，同步更新图标与文档',
          '平台账号操作统一契约，架构解耦，新增平台更简单',
          '统一平台品牌图标资源与处理脚本',
        ],
      },
      {
        kind: 'fixed',
        items: [
          '自动刷新按间隔动态计算令牌过期提前量，并在启动时立即检查一次',
          '修复 Windows 控制台非 UTF-8 编码导致的输出乱码',
          '修复 OAuth 数据序列化命名不一致导致的导入失败',
        ],
      },
    ],
  },
  {
    version: '1.0.3',
    date: '',
    sections: [
      {
        kind: 'added',
        items: [
          '自动更新功能：签名校验、精确下载进度（百分比与文件大小）',
          '更新完成后自动重启应用',
        ],
      },
    ],
  },
  {
    version: '1.0.2',
    date: '',
    sections: [
      {
        kind: 'improved',
        items: ['优化本地路由代理的凭据轮换与故障转移策略', '界面细节与交互反馈优化'],
      },
      {
        kind: 'fixed',
        items: ['修复部分平台上窗口控制按钮点击无效的问题'],
      },
    ],
  },
  {
    version: '1.0.1',
    date: '',
    sections: [
      {
        kind: 'fixed',
        items: ['修复凭据自动刷新在特定间隔下不生效的问题', '修复深色模式下若干对比度问题'],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '',
    sections: [
      {
        kind: 'added',
        items: [
          '首个正式版本：多平台账号管理、凭据托管与机器码绑定',
          '本地路由代理、自动刷新、数据导入导出',
        ],
      },
    ],
  },
]
