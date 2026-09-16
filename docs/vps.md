# AaITR VPS 发布器

正式入口为 `agent-releases.service`，由 `agent-releases.timer` 每小时第 17 分钟触发。Cloudflare 已关闭调度并保持 `DRY_RUN=true`；D1 是切换时的历史快照，不再是实时账本。

- SSH：`aaltr-us`
- 应用：`/opt/agent-releases/app`
- Bun：`/opt/agent-releases/bin/bun`，固定 1.3.14；此 VPS 无 AVX2，使用官方 baseline 构建并核对 SHA-256
- 实时账本：`/var/lib/agent-releases/state.sqlite`，`agentrelease` 所有、权限 0600
- 凭据：`/etc/agent-releases.env`，root 所有、权限 0600，由 systemd 加载
- 模型：沿用 GitHub Secrets 中的端点、密钥和 `glm-5.3-flash`
- 服务以 `agentrelease` 用户运行，仅状态目录可写，单次超时 10 分钟

## 日常操作

```sh
ssh aaltr-us 'systemctl list-timers agent-releases.timer --no-pager'
ssh aaltr-us 'journalctl -u agent-releases.service -n 80 --no-pager'
# 暂停后等待正在执行的服务完成，再维护账本
ssh aaltr-us 'systemctl stop agent-releases.timer'
ssh aaltr-us 'systemctl show agent-releases.service -p ActiveState -p SubState -p Result'
# 恢复调度
ssh aaltr-us 'systemctl start agent-releases.timer'
```

`oneshot` 服务执行成功后会变为 inactive，这是正常状态。查看 `Result=success`、退出码和 `[complete] mode=publish` 日志判断本轮是否成功。timer 保持 active/waiting；宕机恢复后补一次检查，不会补发所有历史版本。

发现 pending 时停发并核对 X 时间线。已发送的记录应补全 tweet ID、标记 posted 并推进对应游标；只有确定未发送才可清理该 pending。不要仅凭超时就删除记录或重试。人工发帖也必须同步实时账本。迁移或备份账本时先停 timer 并确认 service 已结束，避免复制过程中有写入。

## 只读预览

`src/vps.ts` 默认以 SQLite readonly 打开已有账本，只有显式 `--publish` 才允许发布；环境变量不能切换这个入口的模式。缺失账本、参数错误、来源/模型失败、未决 pending 都明确失败。预览不写游标、不创建 pending、不调用 X。

独立预览部署仍保留在 `/opt/agent-releases-preview`，快照 `/var/lib/agent-releases-preview/snapshot.sqlite`，配置 `/etc/agent-releases-preview.env` 只有模型凭据，无 X 凭据。它没有 timer，快照不会自动更新，历史草稿测试使用另一个副本。

```sh
ssh aaltr-us 'systemctl start agent-releases-preview.service'
ssh aaltr-us 'journalctl -u agent-releases-preview.service -n 50 --no-pager'
```

## 验证与切换

```sh
bun install --frozen-lockfile
bun run check
bun run preview:vps /absolute/path/to/snapshot.sqlite
```

SQLite 测试使用真实临时数据库和封闭网络替身，覆盖只读预览、发布前持久化、重复执行、未知发送结果、事务回滚、并发、每日上限、缺失凭据和缺失账本。原 workerd/D1 集成测试继续验证 Worker。

2026-09-16 在 VPS 对四个来源执行真实 `smoke:llm`，全部生成完整中文草稿，合计约 18 秒。凭据通过临时 Actions 工作流按 VPS 一次性公钥加密传递，仅在 VPS 解密；密文 artifact 和一次性私钥随后删除。

正式切换顺序：关闭 Cloudflare cron 并设置预览，确认无在途发布，核对 pending 为零，再导出 D1 最终账本、导入 VPS、运行正式入口并开启 timer。不能同时启用两个发布器。若要切回 Cloudflare，需要先停止 VPS 并把最新 SQLite 账本同步回 D1；直接启用旧 D1 会丢失切换后的发布记录。
