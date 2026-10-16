# 🚀 自动更新配置指南

按照以下步骤配置自动更新功能。

---

## 📋 步骤 1：生成签名密钥对

在项目根目录打开终端，运行：

```bash
npm run tauri signer generate -- -w ~/.tauri/nexus.key
```

**提示**：
- 会提示输入密码，建议设置一个密码（记住它！）
- 如果不想设密码，直接按回车跳过

**输出示例**：
```
Enter a password to encrypt the secret key (optional): ********
Private key: ~/.tauri/nexus.key
Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...
```

**重要**：复制显示的 `Public key:` 后面的长字符串（公钥）

---

## 📋 步骤 2：配置 GitHub Secrets

### 2.1 访问 GitHub Secrets 页面

打开：https://github.com/ad-naan/LutraCredentials/settings/secrets/actions

### 2.2 添加第一个 Secret

点击 **"New repository secret"**

- **Name**: `TAURI_SIGNING_PRIVATE_KEY`
- **Value**: 运行以下命令获取私钥内容

**Windows (PowerShell)**:
```powershell
Get-Content $env:USERPROFILE\.tauri\nexus.key | Out-String
```

**macOS/Linux**:
```bash
cat ~/.tauri/nexus.key
```

复制完整输出（包括 `-----BEGIN PRIVATE KEY-----` 等），粘贴到 Value 框中。

点击 **"Add secret"**

### 2.3 添加第二个 Secret（如果设置了密码）

点击 **"New repository secret"**

- **Name**: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **Value**: 你在步骤 1 设置的密码

点击 **"Add secret"**

**如果没设密码**：可以跳过这个 Secret，或者设置为空字符串。

---

## 📋 步骤 3：更新公钥到配置文件

打开 `src-tauri/tauri.conf.json`，找到这一行：

```json
"pubkey": "你的公钥"
```

替换为步骤 1 复制的公钥：

```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6..."
```

保存文件。

---

## 📋 步骤 4：同步版本号

确保以下 3 个文件的版本号一致（当前应该是 1.0.2）：

1. `package.json` → `"version": "1.0.2"`
2. `src-tauri/Cargo.toml` → `version = "1.0.2"`
3. `src-tauri/tauri.conf.json` → `"version": "1.0.2"`

---

## 📋 步骤 5：提交并发布

### 5.1 提交更改

```bash
git add .
git commit -m "feat: add auto-update functionality"
git push origin main
```

### 5.2 打标签并推送

```bash
git tag v1.0.2
git push origin v1.0.2
```

### 5.3 等待构建

- 访问：https://github.com/ad-naan/LutraCredentials/actions
- 等待 "Release" 工作流完成（约 10-20 分钟）

### 5.4 发布 Release

- 访问：https://github.com/ad-naan/LutraCredentials/releases
- 找到自动创建的 Draft Release
- 检查是否包含 `updater.json` 文件
- 点击 **"Publish release"**

---

## ✅ 步骤 6：测试更新功能

### 6.1 安装当前版本

从 Release 页面下载并安装 v1.0.2

### 6.2 发布新版本测试

1. 修改版本号为 `1.0.3`（3 个文件）
2. 提交并打标签：
   ```bash
   git add .
   git commit -m "chore: bump version to 1.0.3"
   git tag v1.0.3
   git push origin v1.0.3
   ```
3. 等待构建完成并发布 Release

### 6.3 在应用中检查更新

1. 打开已安装的 v1.0.2 应用
2. 进入 **设置** 页面
3. 点击 **"立即检查"** 按钮
4. 应该会弹出更新对话框，显示 v1.0.3 可用
5. 点击 **"下载并安装"**
6. 等待下载完成，应用会自动重启
7. 重启后版本应该变为 v1.0.3

---

## 🎉 完成！

现在你的应用已经支持自动更新了！

### 用户体验：
- ✅ 应用启动时自动检测更新
- ✅ 设置页面手动检查更新
- ✅ 一键下载并安装
- ✅ 自动重启应用
- ✅ 签名验证保证安全

### 后续发布流程：
1. 更新版本号（3 个文件）
2. `git tag v1.0.x && git push origin v1.0.x`
3. 等待构建完成
4. 发布 Release
5. 用户自动收到更新通知

---

## 🔧 故障排查

### 问题 1：密钥生成失败

**错误**：`command not found: tauri`

**解决**：
```bash
npm install -g @tauri-apps/cli
```

### 问题 2：GitHub Actions 构建失败

**检查**：
- Secrets 是否正确配置
- 私钥内容是否完整（包括开头和结尾）
- 密码是否正确（如果设置了）

### 问题 3：更新检测失败

**检查**：
- `updater.json` 是否在 Release 中
- Release 是否已发布（不是 Draft）
- 网络连接是否正常

### 问题 4：签名验证失败

**原因**：公钥和私钥不匹配

**解决**：
1. 重新生成密钥对
2. 更新 GitHub Secrets
3. 更新 `tauri.conf.json` 中的公钥
4. 重新构建发布

---

## 📞 需要帮助？

如果遇到问题，请提供：
1. 错误信息截图
2. GitHub Actions 日志
3. 应用日志（如果有）

我会帮你解决！
