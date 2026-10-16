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
    version: '1.0.3',
    date: '2026-10-16',
    sections: [
      {
        kind: 'added',
        items: [
          '右上角版本号现在可以点击，弹出菜单支持检查更新',
          '新增更新日志看板，每次更新后可查看具体变更内容',
          '新增独立的数据与路径页面（数据存储、备份恢复、日志、本地平台路径）',
        ],
      },
      {
        kind: 'improved',
        items: [
          '设置页重构：自动刷新、本地代理、代理配置、外观与关于，结构更清晰',
          '用量统计卡片布局重新设计，与整体工作台视觉统一',
          '顶栏导航在窗口较窄时可横向滑动切换，不再与右侧工具按钮重叠',
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
