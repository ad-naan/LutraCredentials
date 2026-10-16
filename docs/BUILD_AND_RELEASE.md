# 构建和发布指南

## 应用信息

- **应用名称**: LutraCredentials
- **标识符**: com.lutra.credentials
- **当前版本**: 1.0.3
- **描述**: 统一的多平台 AI 账户管理工具

## 本地构建

### 开发模式

```bash
# 启动开发服务器
npm run dev

# 启动 Tauri 开发模式（带热重载）
npm run tauri:dev
```

### 生产构建

```bash
# 构建生产版本
npm run tauri:build

# 构建调试版本（更快，但体积更大）
npm run tauri:build:debug
```

构建产物位置：
- **Windows**: `src-tauri/target/release/bundle/msi/` 和 `src-tauri/target/release/bundle/nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/` 和 `src-tauri/target/release/bundle/macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 和 `src-tauri/target/release/bundle/appimage/`

## GitHub Actions 自动发布

### 触发发布

1. **创建版本标签**：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **手动触发**：
   - 访问 GitHub Actions 页面
   - 选择 "Release" workflow
   - 点击 "Run workflow"

### 发布流程

工作流会自动：
1. 在 Windows、macOS (Intel + Apple Silicon)、Linux 上构建应用
2. 创建 GitHub Release（草稿状态）
3. 上传所有平台的安装包

### 支持的平台

- **Windows**: `.msi` 和 `.exe` 安装包
- **macOS**: 
  - Intel (x86_64): `.dmg` 和 `.app`
  - Apple Silicon (aarch64): `.dmg` 和 `.app`
- **Linux**: `.deb`、`.AppImage` 和 `.rpm`

## 版本管理

需要同步更新以下文件中的版本号：

1. `package.json` - `version` 字段
2. `src-tauri/tauri.conf.json` - `version` 字段
3. `src-tauri/Cargo.toml` - `version` 字段

### 版本更新脚本

```bash
# 更新到新版本（例如 1.1.0）
NEW_VERSION="1.1.0"

# 更新 package.json
npm version $NEW_VERSION --no-git-tag-version

# 手动更新 src-tauri/tauri.conf.json 和 src-tauri/Cargo.toml
# 然后提交并打标签
git add .
git commit -m "chore: bump version to $NEW_VERSION"
git tag v$NEW_VERSION
git push origin main --tags
```

## 代码签名（可选）

### Windows

需要配置 Windows 代码签名证书：

```yaml
# 在 GitHub Secrets 中添加：
WINDOWS_CERTIFICATE: <base64 编码的 .pfx 证书>
WINDOWS_CERTIFICATE_PASSWORD: <证书密码>
```

### macOS

需要配置 Apple 开发者证书：

```yaml
# 在 GitHub Secrets 中添加：
APPLE_CERTIFICATE: <base64 编码的 .p12 证书>
APPLE_CERTIFICATE_PASSWORD: <证书密码>
APPLE_ID: <Apple ID>
APPLE_PASSWORD: <应用专用密码>
APPLE_TEAM_ID: <团队 ID>
```

## 图标设计

当前图标位于 `src-tauri/icons/` 目录：

- `icon-source.svg` - 源图标（SVG 格式，可编辑）
- 其他 PNG/ICO/ICNS 文件 - 自动生成的各种尺寸

### 更新图标

1. 编辑 `src-tauri/icons/icon-source.svg`
2. 运行生成脚本：
   ```bash
   npm run icons:generate
   ```

这会自动生成所有需要的尺寸。

## 发布检查清单

发布前确认：

- [ ] 所有测试通过
- [ ] 版本号已更新（package.json、tauri.conf.json、Cargo.toml）
- [ ] CHANGELOG.md 已更新
- [ ] 文档已更新
- [ ] 图标正确显示
- [ ] 在所有目标平台上测试过
- [ ] 代码签名配置正确（如需要）

## 故障排查

### 构建失败

1. **依赖问题**：
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Rust 缓存问题**：
   ```bash
   cd src-tauri
   cargo clean
   cd ..
   ```

3. **前端构建问题**：
   ```bash
   npm run build
   ```

### GitHub Actions 失败

- 检查 Actions 日志中的错误信息
- 确认所有必需的 Secrets 已配置
- 验证 workflow 文件语法正确

## 参考资源

- [Tauri 文档](https://tauri.app/)
- [Tauri Action](https://github.com/tauri-apps/tauri-action)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
