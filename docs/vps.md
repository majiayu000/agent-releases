# AaITR VPS 预览部署

此部署只做预览，正式发布仍由 Cloudflare Worker 执行。VPS 不配置 X 凭据、不启用发布定时器。

- SSH：`aaltr-us`
- 应用：`/opt/agent-releases-preview/app`
- Bun：`/opt/agent-releases-preview/bin/bun`，与 CI 一致固定为 1.3.14；此 VPS 无 AVX2，使用官方 `bun-linux-x64-baseline` 构建并核对下载 SHA-256
- 只读账本快照：`/var/lib/agent-releases-preview/snapshot.sqlite`
- 手动服务：`agent-releases-preview.service`，以 `agentrelease` 用户执行一次后退出
- 模型配置（配置后才可生成新草稿）：`/etc/agent-releases-preview.env`，root 所有、权限 0600

## 手动预览

```sh
ssh aaltr-us 'systemctl start agent-releases-preview.service'
ssh aaltr-us 'journalctl -u agent-releases-preview.service -n 50 --no-pager'
```

入口始终传入预览模式，并以 SQLite readonly 打开已经存在的数据库。即使环境变量 `DRY_RUN=false` 也不会启用发布。预览不初始化或修改游标，不创建 pending，不调用 X。参数错误、来源/模型失败、未决 pending 都以非零状态退出。

账本必须从 D1 重新获取；这是检查时的快照，Cloudflare 后续发布不会同步过来。对历史版本做草稿测试时使用单独的数据库副本，不修改原快照。模型密钥只用于生成中文，不需要 X 发帖密钥。

## 本地验证

```sh
bun run check
bun run preview:vps /absolute/path/to/snapshot.sqlite
```

`src/vps.test.ts` 使用真实 SQLite 和封闭网络替身，X 调用被替身替换。覆盖只读预览、持久化意图、防重复、未知发送结果、事务回滚、重叠执行和每日上限。原 workerd/D1 集成测试继续验证 Worker。

后续若切换正式发布，需要另外启用正式 VPS 入口，停掉 Cloudflare 定时器并等待在途任务结束，核对 pending 后转移最终账本，再启用 VPS 定时器。本次没有执行这些切换。
