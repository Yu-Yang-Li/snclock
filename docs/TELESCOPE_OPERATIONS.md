# 望远镜接入开发与验收边界

本批开发不修改 SN Clock 的采集、模型、告警或现行望远镜处理 cron。
观测操作默认关闭；测试回执不代表设施授权或真实接通。

## 已实现的软件路径

- `/telescope-data/operations/`：选择已有目标，填写 UTC 窗口、波段、次数、曝光秒数及气团；支持完整 JSON 多历元输入。
- 本地保存 → 校验 → 批准准确摘要 → 排队 → 独立后台执行。网页 GET 不调用设施；LCO 提交还要求 30 分钟内成功的远端预检。
- 配置、目标坐标、载荷发生变化后禁止沿用审批。用户必须属于申请组，并拥有目标的对象级 `tom_targets.change_target` 权限；批准/发送还需 `telescope_ops.approve_plan`。活跃超级用户保留管理权限。
- 全局、设施及真实写入开关均由服务端执行。排队后撤销授权/审批或关闭开关，执行阶段再次拒绝。
- 幂等键重用返回原任务；同一计划的提交/取消各最多一次。写请求超时标记 `unknown`，不会自动重发。执行中进程中断需核对设施记录，不能把“本地没收到”当“设施没收到”。
- 日报 JSON/HTML 归一到带内容指纹的 `current/report.json`，只复制引用的 QA 图片。原始报告 SHA 和资产 SHA 保存到版本目录的 manifest。图片变化也会使 API 版本变化；切换失败保留上一版。
- SSH 同步先取单个报告，再按引用名单取图片（最多 256 张、每张 32 MiB）；不拉整个项目/资产树，不上传文件、不运行远端脚本。只用于可信、授权的报告目录。

## 各设施实际范围

| 设施 | 已开发 | 尚不能声称完成 |
| --- | --- | --- |
| LCO | 原生预检、提交、状态、取消后独立回读；按 request ID 分页列 e91 文件 | 真实申请授权、回执联调、文件下载及科学处理回流 |
| LT | RTML 3.1a/SOAP 构建与发送；匹配 UID/申请/序列；reject 不作成功；取消后独立 update | 真实网关/身份映射；执行历史细分；夜包下载、FITS 匹配及处理 |
| TRT | 原生请求体与 TRT 认证头；赤经时角/赤纬角度格式；保留波段大小写；按交接格式识别 WCS 文件列表 | 状态语义待真实回执验证；取消操作不开放；未自动登记远端下载链 |
| REM | 延用报告中的测光、QA、状态和日报读取 | 交接未提供已验证提交协议，不提供虚构的提交按钮 |

“查询文件”目前是文件列表任务，结果为 `listed_only`，不表示下载完成或测光完成。
新请求的设施状态与历史日报处理状态分开，不用旧测光给新请求标记完成。
本地操作 API 是上述工作流的接口，不宣称实现交接 OpenAPI 的所有路径。

提交回执确认后，真实设施 ID 与待登记单在同一次数据库更新中保存。
授权用户可用 `GET /telescope-data/operations/api/plans/<uuid>/registration` 导出 JSON；
它冻结当时目标、申请、观测载荷和内容摘要，重复导出不会再次提交观测。
响应不缓存；未经确认或摘要不一致的记录拒绝导出。登记单含目标和观测参数，应作为私有数据保管。
`state=pending` 仅表示本地保留待登记材料，不是远端已入库的证明，也不是师兄服务器已支持的接收协议。
自动登记仍需核实 transient1 的现有登记入口；不新建重复下载任务，也不能通过重提观测修复登记失败。

协议依据：交接包 `NATIVE_INTERFACES.md`、[LCO 官方文档](https://developers.lco.global/)、
[LT 官方 RTML](https://telescope.livjm.ac.uk/PropInst/RTML/)。LT/TRT 的模拟用例不替代真实客户端兼容性验收。

## 私有配置（示例不可直接启用生产）

配置放在部署专用 `local_settings.py`，凭据值仅从受限环境文件加载。不要复制历史目标、日期、申请号或旧 token。

```python
TELESCOPE_OPERATIONS_ENABLED = False
TELESCOPE_PROFILES = {
    'lco-imaging': {
        'facility': 'LCO', 'proposal': 'REPLACE_WITH_AUTHORIZED_PROPOSAL',
        'group': 'lco-observers', 'enabled': False,
        'live_writes': False, 'protocol_verified': False,
        'instrument': '1M0-SCICAM-SINISTRO', 'telescope_class': '1m0',
        'filter_map': {'g': 'gp', 'r': 'rp', 'i': 'ip', 'z': 'zs'},
        'token_env': 'SNCLOCK_LCO_TOKEN',
        'archive_token_env': 'SNCLOCK_LCO_ARCHIVE_TOKEN',
    },
}
TELESCOPE_REPORT_SYNC = {
    'enabled': False, 'mode': 'local',
    'source': '/AUTHORIZED_REPORT_SOURCE/latest.json',
    'destination': '/PRIVATE_REPORT_STORE',
}
# When report sync is configured:
# TELESCOPE_SNAPSHOT_PATH = '/PRIVATE_REPORT_STORE/current/report.json'
```

LT 配置额外需要 `endpoint`（HTTPS）、`username_env`、`password_env`、
`contact_user`、`instrument`、`binning: [1, 1]` 和经实际验证的滤片映射。
TRT 额外需要 `site`、`binning: '1,1'`、该优先级专用 `token_env` 与台站滤片映射。
必须显式设置 `priority: 70`、`84` 或 `88`；发送前核对 JWT 声明的优先级、起止时刻及 exp，
观测窗口不能超过有效期。这只是本地一致性检查，不验证 JWT 签名或服务端配额。
各优先级分开建配置，不把一个 token 的权限推广到其他申请/优先级。
`protocol_verified` 必须有脱敏真实回执和申请身份核对支持，不能仅因单元测试通过设置。

SSH 报告模式设置 `mode: 'ssh'`、`ssh_alias`、`source`（绝对目录）、
`report_name`（单个 `.json`/`.html` 文件）。SSH 别名、主机指纹与只读权限由管理员配置；不接受网页传入地址。

## 数据库、后台及验证

本批包含 `telescope_ops/0001_initial` 与 `0002_plan_registration_payload`，上线须先备份目标数据库，再按既有发布流程迁移。
下面后台命令需要明确加载部署配置；不会自行注册 timer/cron。

```sh
python manage.py migrate --settings=tom_snclock.production_settings
python manage.py run_telescope_jobs --limit 10 --settings=tom_snclock.production_settings
python manage.py sync_telescope_snapshot --settings=tom_snclock.production_settings
```

不要把生产命令用于测试。安全检查在无 `local_settings.py`、无生产环境文件的独立目录执行：

```sh
python manage.py test custom_code telescope_data telescope_ops --settings=tom_snclock.test_settings --noinput
python manage.py makemigrations telescope_ops --check --dry-run --settings=tom_snclock.test_settings
```

`run_telescope_jobs --recover-stale` 把超过 10 分钟的运行中写任务标为 unknown，查询任务标为 failed；均不重排队。
停用时关闭总开关并停止任务调度；已经发出的 HTTP 无法被开关撤回。任何真实取消仍需精确确认。

## 下一步真实验收所需

1. 师兄报告目录的只读访问方式、LT/TRT 无凭据客户端或真实脱敏回执、各申请的授权配置。
2. 只读状态/报告逐字段比对；LT/TRT 回执不兼容时先修解析，保持真实写入关闭。
3. 经科学负责人明确批准的一条实际观测，核验设施 ID、窗口、滤片、执行、文件及最终产品；这不是自动化测试的一部分。
4. 下载/处理对接完成且浏览器操作验收后，才可称“全链路接通”。本批不宣称完成该项。

## 本轮验证记录（2026-09-13）

- 独立目录 `/home/ubuntu/snclock-ops-test-Ducxyy/tom`，内存 SQLite、内存缓存，未加载生产环境或私有 settings。
- `custom_code telescope_data telescope_ops` 共 72 项通过，其中新增操作/同步测试 35 项；迁移 `--check --dry-run` 无差异，`git diff --check` 通过。
- 先复现后修复：全局关闭后任务仍能执行、UUID 类型导致幂等重放冲突、异常回执悬挂、JSON 错扩展名、非法资产路径被跳过、图片变更未改变报告身份、TRT 坐标格式、等价时区写法绕过去重。
- 模拟 transport 验证包含 LCO 取消后独立 GET、LT confirm/reject/错 UID/缺序列、TRT 认证头与标量/列表 ID、外域分页拒绝、权限撤销、CSRF、超时不重发、只同步报告引用文件。
- 未执行生产迁移、服务重启、真实提交/取消、真实归档下载；本轮尚未进行浏览器点击验收。代码保留在工作区，未发布。

## 增补交接包核对（2026-09-13，v0.2）

用户补充 `telescope_submission_handoff_20260913.zip` 和 TRT 三档凭据后，优先接观测申请，
下载/处理/结果复用师兄已有服务器链路，不另建下载器或 cron。

- 新包自带 9 项离线测试实跑通过；SN Clock 80 项回归通过（此前 72 项，本批新增 8 项），迁移无差异。
- TRT 对齐原生字符串曝光/次数/气团和 Subframe、PA、Dither、ExposuresMode、M3Port、isQuicklook 字段；增加优先级/台站/binning 校验。
- TRT 无虚构 success 字段但带严格格式的单一 obs_id 可以记录为提交已接收；含错误或多个 ID 的歧义回执不确认。此状态不表示观测完成。
- LT 增加重复 SOAP return、Fault、错误 RTML 根节点及重复 Project 的拒绝检查。
- 原交接客户端只在独立临时目录离线运行，没有复制到公开仓库；公开再分发许可仍需负责人确认。
- 截至该轮，真实凭据未写入仓库、测试、发布包或服务器配置，尚未执行携凭据的设施调用；下一轮只读探测见下文。

现场连接检查：北京服务器 sn-clock / tom-snclock / stdweb-snclock / nginx 均 active；
此机未发现 `/run/sn-observer/api.sock` 和 `/home/wangziy/SN_dashboard`，`transient1` 不能解析；
本机 SSH 配置也没有 transient1 别名。新包明确 socket 服务和共享权限只是待实施方案。

截至该轮发布门禁未满足：需要 transient1 的真实 SSH 地址/端口/合作账号或已部署接口及授权共享路径，
LT 网关/申请与联系人映射、LCO 申请及凭据的安全注入方式，以及 REM 已验证的提交协议（新包仍未提供）。
取得连接后先检查现行登记脚本和锁，用最小适配登记真实 ID；登记失败不能重新提交观测。
若采用包中独立执行器边界，还需负责人确认执行器身份/审批端与网站的授权关系，不能把网页服务账号提升为服务器负责人。

当前分支 `feat/telescope-submission-handoff`，未发布、未修改线上数据库或服务。

### TRT 实际只读接口探测（2026-09-13，北京时间约 20:00）

使用用户授权提供的 P88/P84/P70 凭据，内存中还原聊天产生的下划线转义，
仅向官方 `checkobservation` POST `{"obs_id":[]}`。未调用 newobservation/cancelobservation，
不保存原始响应，不输出目标/身份/令牌。

- 三档优先级和有效期声明本地一致（不等于签名验证）。
- 第一轮 P88 连接失败；P84/P70 HTTP 200。第二轮三档均 HTTP 200，均返回长度 1 的列表。
- 第二轮没有匹配到预设的英文认证错误标记；空 ID 响应不是实际观测记录，不证明具备提交权限或配额。
- 下一步应以负责人提供的一个真实既有 obs_id 查询，核对其归属与状态，不能为了验证而新提观测。
- 本轮未保存凭据到服务器配置，也未启用真实写入或部署功能。

同期北京服务器四项主服务 active；SN `/health` 为 status=ok 但 attention_required=true：
当时显示连续 9 轮无候选、78 个源红移待复核，LSST 探针对象较旧。此为独立运行提示，
不能据此推断摄取失败或全流停更；本轮未修改相关筛选/采集逻辑。

### 提交后登记与状态收尾（2026-09-13）

- 同一隔离环境重新执行全部 95 项测试，通过；迁移检查无差异。
- 新增确认回执后登记单保存、重复导出、目标改名后内容不变、无授权/未确认/摘要不一致拒绝导出测试。
- 已有提交任务后页面隐藏再次下发和批准按钮；中断写入显示“结果待核对，勿重复提交”。
- LT reject 查询不再标成功；TRT 不开放尚未实现回执确认的取消操作。
- TRT 只统计 `file_path` 中非空 WCS 路径，原始文件不混入计数，列表结果不泄露文件 URL；异常文件列表不标成功。
- 以上为自动化回归和模板响应验证，尚未完成浏览器点击及真实设施验收；未执行生产迁移、部署或真实观测提交。

### 私有配置增补后的真实只读验证（2026-09-13）

最新私有交接已提供 LT 网关/认证/部分申请映射、LCO 申请及令牌，以及 TRT 历史观测 ID 清单；
此前“缺 LT/LCO 凭据、缺 TRT ID”的描述仅为收到该包之前的状态，不能再用作当前阻塞理由。

- LCO：官方 HTTPS 申请详情、归档账号权限、指定申请历史请求查询均返回 200，申请处于 active。
  随后在北京服务器隔离目录使用本仓库 `Client.lco('status')` 与 `Client.frames()` 实测，
  请求归属匹配并成功列出 e91 文件。凭据仅经 SSH 标准输入进入进程内存，未写入生产配置。
  这是状态/文件列表只读验证，不是远程 validate、提交或完整下载处理验收。
- LT：私有包提供的是 HTTP 网关，不是 HTTPS；本轮没有发送认证信息。
  不自动改协议、不全局放宽 HTTPS 限制。仍需设施安全入口或管理员审查的专用传输方案。
  归档认证未包含在新包中；另一申请的联系人映射仍待核验。
- TRT：清单含 41 个唯一历史 ID、5 个目标，全部未标明确优先级；本轮仅核对清单，未实时查询。
  历史登记不能推断当前状态，也不能据此猜测令牌所属优先级。
- transient1 连接/自动登记入口、REM 已验证提交协议仍未补齐。
- 本轮未部署、未迁移生产数据库、未启用真实写入、未提交或取消观测。
