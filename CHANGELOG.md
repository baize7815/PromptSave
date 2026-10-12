# Changelog

## v0.5.0 — 2026-10-13

- 新增可选的七牛云 Kodo S3 兼容手动备份：上传当前 ZIP 到固定对象 `promptsave/backup.zip`，再次上传会覆盖同一对象；支持从该对象导入并合并或导入并替换。
- 云端导入沿用本地 ZIP 的解析、数据和图片校验及导入路径；替换模式沿用现有本地流程保存恢复副本。
- 发布包不预设存储桶地址、AccessKey 或 SecretKey。用户填写的 endpoint 和 AccessKey 保存在本机 `chrome.storage.local`，SecretKey 只保存在 `chrome.storage.session`，浏览器重启后需要重新输入。
- 七牛云配置和导入导出操作加入设置页；ZIP 仍受 32 MiB 限制，云端备份应使用私有存储空间。
- 网格和列表改为每批 24 条的滚动加载，增加返回顶部按钮；顶部工具栏和筛选栏支持吸顶显示，并按工具栏高度避让。
