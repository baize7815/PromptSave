# Windows 本地桥接

此目录用于打开 Windows 资源管理器，并使目录存储不再依赖浏览器 File System Access 授权。需要现有的 Python 3（包含 tkinter），不安装第三方依赖。

## 安装一次

桥接程序与扩展文件夹相互独立：浏览器通过本机注册表找到桥接，桥接清单通过扩展 ID 授权调用方。因此**扩展文件夹可以放在任何位置甚至随意移动**；桥接默认统一部署到“文档\PromptSave\native”。

1. 在 Chrome / Edge 扩展管理页重新加载扩展，复制扩展 ID。
2. 双击本目录的 `install.bat`（保留窗口供查看结果）。脚本会自动：
   - 把 `host.py`、`install.bat`、`install.ps1`、`README.md` 复制到 `%USERPROFILE%\Documents\PromptSave\native`；
   - 在部署目录生成 `launch.cmd` 与 `com.promptshelf.local.json`；
   - 注册当前用户的 Chrome / Edge 原生消息主机（无需管理员权限，不修改执行策略、不安装 Python、不修改 PATH）。

   脚本会询问扩展 ID；Chrome 和 Edge 同时使用时一次填入两个 ID，用逗号分隔。重复运行会覆盖程序文件，但保留部署目录下的 `grants\`（数据文件夹连接记录）。也可先在 PowerShell 中进入本 `native` 目录，再运行：

```powershell
& '.\install.ps1'
```

若系统执行策略阻止脚本，可在用户自己确认脚本内容后，仅为该进程运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\install.ps1'
```

显式指定参数，避免交互输入：

```powershell
& '.\install.ps1' -ExtensionId '这里填32位扩展ID' -PythonPath 'C:\Path\To\python.exe'
```

自定义部署目录（默认为“文档\PromptSave\native”）：

```powershell
& '.\install.ps1' -ExtensionId '这里填32位扩展ID' -InstallDir 'D:\PromptSave\native'
```

部署目录路径不能含 cmd 特殊字符，不能位于网络共享；有中文的 Python 路径需要可用的 Windows 短路径。只装一个浏览器也可以注册；未使用浏览器的同名键不产生访问权限。若“文档”被 OneDrive 重定向，脚本会给出警告，同步冲突可能影响桥接，可用 `-InstallDir` 指定非同步目录。

3. 重新加载扩展。在设置里点击“连接本地目录（免重复授权）”，由系统选择器选择储存文件夹。
4. 已经使用目录存储时，选择原来的数据目录。元数据与当前缓存完全相同的数据集直接接入；其他已有数据的目录会询问使用还是合并。空目录需要从当前存储复制数据；如果当前浏览器目录权限已过期，应先点“重新授权”再迁移。取消或失败会保留原存储。
5. 点击工具栏的文件夹图标，应打开选定目录的 Windows 资源管理器。完全退出并重开浏览器后检查读写。

桥接注册只允许清单中列出的扩展 ID，浏览器重开无需重新授予文件权限。

**移动扩展文件夹或发给别人**：未打包扩展的 ID 由所在路径决定。把扩展移动到新位置并在浏览器中重新加载后，若 ID 改变，双击**部署目录**（文档\PromptSave\native）里的 `install.bat` 并输入新 ID 即可；桥接程序和已连接的数据文件夹都不用动。把扩展发给别人时，对方在自己电脑上双击随扩展分发的 `native\install.bat`、输入他自己的扩展 ID 即完成部署。更新桥接程序（host.py）时在任意副本上重新运行安装脚本即可，部署目录会更新文件并保留 grants。目录移动/删除、Windows 文件权限改变时仍需重新连接或修复。浏览器企业策略也可能禁用 native messaging。扩展仍保留浏览器目录模式和扩展本地存储模式。

## 数据访问范围

桥接的文件夹选择器确认目录后，将“目录标识 → 路径”和扩展来源保存在 `native/grants/`。扩展只保存标识和显示名称；网页不能传入任意绝对路径。程序不联网，不自动记录日志，不接受任意程序或 shell 命令。只读写目录内 `data.json`、`recovery.json`、`images/<image-id>.jpg`，仅允许删除托管 JPG；拒绝路径穿越、符号链接、Windows 目录联接和设备文件名。图片读写最多 12 MiB、JSON 读写最多 8 MiB；新收藏压缩图最多 512 KiB。小文件一次返回，大文件分块读取并检测文件版本变化，每个文件用临时文件原子替换。不同浏览器/外部编辑器的同时写入仍按项目的单写入端约定处理。

0.3.0 的侧边栏和完整页面共用后台的一条桥接连接，文件请求串行排队，队列限长且限制待发送图片总量。闲置 5 秒主动断开，Python 程序随浏览器关闭输入而退出，不运行心跳或常驻服务；连接中断不会自动重发可能已提交的写入。协议也已升级，请同时保留新版扩展和 `host.py`。

## 停用与排错

卸载前建议在扩展中“迁移并切回本地”，或者继续保留数据目录和 ZIP 备份。以下命令只取消注册表中的桥接注册，保留部署目录、全部收藏和 `grants` 连接记录；在部署目录（文档\PromptSave\native）或随扩展分发的 native 目录中运行均可，注册值指向其他有效桥接时会拒绝删除：

```powershell
& '.\install.ps1' -Uninstall
```

桥接不可用时，扩展显示最近缓存并停止目录写入，不自动切换存储。设置中的调试页可临时开启、导出、关闭并清除日志。新增 `native:failed` 事件只含操作名和错误码，不记录目录路径或文件内容。反馈时提供浏览器版本、扩展版本、失败步骤和导出的日志即可。

参考：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[官方 Windows launcher 示例](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples/nativeMessaging/host)。
