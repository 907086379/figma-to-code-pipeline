# Figma i18n 多语管理实践（设计师可执行）

> 目标：在 Figma 内建立可维护、可协作、可被 AI/代码稳定消费的多语配置体系。

## 1. 设计侧总原则

- 文案管理从“文本本身”转为“语义 key”管理。
- 布局按“最长文案”设计，不按中文短文案设计。
- 文案替换与布局规则解耦，避免换语言后页面崩坏。
- Key 稳定优先于文案内容稳定（key 变更成本最高）。

## 2. 在 Figma 中的落地结构（推荐）

建议在同一个 Figma 文件内固定 3 个页面：

- `I18N Dictionary`：多语主表（单一事实源）。
- `I18N Patterns`：长度压力样例（short/long/extreme）。
- `Screens`：业务页面（实际交付稿）。

## 3. I18N Dictionary 主表怎么建

每条文案一行，建议包含以下字段：

- `key`：唯一语义键（如 `i18n.auth.login.submit`）
- `zh-CN`：中文文案
- `en-US`：英文文案
- `scene`：使用场景（按钮/标题/提示/错误）
- `maxLines`：最大行数（1/2/3）
- `overflow`：`ellipsis` / `wrap` / `clip`
- `placeholders`：变量占位（如 `{name},{count}`）
- `notes`：上下文说明、禁译词、语气约束

示例：

- `i18n.common.confirm` | 确认 | Confirm | button | 1 | ellipsis | - | 主操作按钮
- `i18n.cart.item_count` | 共 {count} 件 | {count} items | text | 1 | ellipsis | {count} | count 为整数

## 4. 页面设计时的具体操作规则

### 4.1 文本节点命名

- 文本图层命名直接使用 `key`，禁止“标题1/文案2/说明文字”。
- 可见文本先用 `zh-CN`（或团队默认语言）便于评审。
- 同一个 key 在多个页面重复使用时，命名必须完全一致。

### 4.2 组件与变体

- 可复用文本块必须组件化。
- 关键组件必须提供长度变体：
  - `contentLength=short`
  - `contentLength=long`
  - `contentLength=extreme`
- 关键交互组件补齐状态：default/focus/error/disabled（按业务存在提供）。

### 4.3 Auto Layout 与约束

- 文本容器必须定义拉伸策略（Hug/Fill/Fixed 之一）。
- 按钮、标签、导航等易受文案长度影响区域禁止死宽。
- 必须明确溢出策略（单行省略、多行换行或裁切）。

## 5. 动态文本与格式化规范

- 动态内容统一使用占位符：`{count}`、`{amount}`、`{date}`、`{name}`。
- 占位符命名全文件唯一口径，禁止同义多写（如 `{num}` 与 `{count}` 混用）。
- 金额/日期在设计稿中给示例，但不写死最终格式规则（格式由 i18n 运行时处理）。

## 6. RTL 与多区域语言（可选但建议预留）

- 对可能支持 RTL 的产品，提前标注镜像策略：
  - 需要镜像的容器与对齐方向
  - 不应镜像的品牌元素/图标
- 使用 Auto Layout 实现可翻转布局，减少后续重做成本。

## 7. 团队治理与变更流程（关键）

### 7.1 角色分工

- 设计系统 owner：维护 key 命名规范、批准 key 新增/重命名。
- 业务设计师：新增页面文案、维护翻译值、补上下文说明。
- 研发/AI：消费 key 与规则，不反向改 key。

### 7.2 变更约束

- 新增文案：先在 `I18N Dictionary` 建 key，再进入业务页面。
- 修改文案：可改 `zh-CN/en-US`，不改 key（除非评审通过）。
- 废弃文案：标记 `deprecated`，至少保留一个迭代周期再删除。

## 8. 每次交付给研发/AI 的最小包

- Figma 链接 + 关键 node-id 列表
- 最新 `I18N Dictionary`
- key 变更清单（新增/重命名/废弃）
- 长文案风险点清单（哪些模块需要重点验收）

## 9. 设计师提交前检查（1 分钟）

- 是否还有无语义命名文本层？
- 是否存在未入主表的新增文案？
- 是否关键组件只做了短文案，没做长文案压力验证？
- 是否遗漏错误态/禁用态等状态文本？
- 是否占位符命名一致且可解释？

## 10. 常见失败模式（避免）

- 用中文文本本身当“唯一标识”而非 key。
- 页面已改文案，但 `I18N Dictionary` 未同步。
- 组件仅在默认语言可用，长文案或英文直接破版。
- 动态文本写死格式，导致运行时无法本地化。

---

## 附：推荐 key 命名规则（简版）

- 结构：`i18n.<模块>.<页面或组件>.<语义>`
- 示例：
  - `i18n.auth.login.title`
  - `i18n.auth.login.submit`
  - `i18n.order.list.empty`
  - `i18n.common.cancel`

约束：

- 全小写、点分隔、语义稳定。
- 不包含语言信息（如 `zh`、`en`）。
- 不包含展示样式信息（如 `red`、`bold`）。

---

## 附：多语言平铺（Flat Key）支持模板

> 适用场景：团队希望用“平铺 key”（单层字符串）而非点分层 key，便于 Excel/脚本批量处理。

### A. Flat Key 命名规则

- 统一前缀：`i18n_`
- 分隔符：下划线 `_`
- 推荐结构：`i18n_<模块>_<页面或组件>_<语义>`
- 全小写，禁止空格、中文、特殊符号
- 语义稳定，不包含样式与语言信息

示例：

- `i18n_auth_login_title`
- `i18n_auth_login_submit`
- `i18n_order_list_empty`
- `i18n_common_cancel`

### B. Figma 中如何实践 Flat Key

- 文本图层命名直接使用 Flat Key（如 `i18n_auth_login_submit`）。
- `I18N Dictionary` 主表 `key` 列统一改为 Flat Key。
- 变量占位规则不变：`{count}`、`{amount}`、`{date}`、`{name}`。
- 若历史稿是点分 key，可增加一列 `legacyKey` 做迁移映射，避免一次性重命名风险。

### C. I18N Dictionary（Flat）字段模板

- `key`
- `zh-CN`
- `en-US`
- `scene`
- `maxLines`
- `overflow`
- `placeholders`
- `notes`
- `status`（`active` / `deprecated`）
- `legacyKey`（可选）

### D. 可直接复制的平铺示例（10 条）

| key | zh-CN | en-US | scene | maxLines | overflow | placeholders | notes | status | legacyKey |
|---|---|---|---|---|---|---|---|---|---|
| i18n_common_confirm | 确认 | Confirm | button | 1 | ellipsis | - | 主操作按钮 | active | i18n.common.confirm |
| i18n_common_cancel | 取消 | Cancel | button | 1 | ellipsis | - | 次操作按钮 | active | i18n.common.cancel |
| i18n_auth_login_title | 登录账号 | Sign in | title | 1 | ellipsis | - | 登录页标题 | active | i18n.auth.login.title |
| i18n_auth_login_submit | 立即登录 | Sign in now | button | 1 | ellipsis | - | 登录提交按钮 | active | i18n.auth.login.submit |
| i18n_auth_login_error_invalid | 账号或密码错误 | Invalid username or password | error | 2 | wrap | - | 登录失败提示 | active | i18n.auth.login.error_invalid |
| i18n_cart_item_count | 共 {count} 件 | {count} items | text | 1 | ellipsis | {count} | 购物车数量 | active | i18n.cart.item_count |
| i18n_order_pay_amount | 实付 {amount} | Pay {amount} | text | 1 | ellipsis | {amount} | 支付金额展示 | active | i18n.order.pay.amount |
| i18n_order_list_empty | 暂无订单 | No orders yet | empty | 1 | ellipsis | - | 订单空态标题 | active | i18n.order.list.empty |
| i18n_profile_welcome_user | 欢迎你，{name} | Welcome, {name} | text | 1 | ellipsis | {name} | 个人页欢迎语 | active | i18n.profile.welcome_user |
| i18n_common_retry | 重试 | Retry | button | 1 | ellipsis | - | 异常态重试按钮 | active | i18n.common.retry |

### E. 平铺模式下的额外检查

- 同一语义不得出现多个近义 key（如 `i18n_common_ok` 与 `i18n_common_confirm` 重复）。
- key 重命名必须同步更新图层命名与主表，不允许只改一侧。
- `deprecated` key 不立即删除，至少保留一个迭代周期。
