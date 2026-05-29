# 内置 Agent 与数据能力清单

## Agent 清单

| Agent | 类型 | 能力 |
|---|---|---|
| 数据智能体总控 Agent | router | 意图识别、自动路由、Codex 嵌套 |
| 销售经营问数 Agent | chatbi | 销售 TopN、趋势、BG/BU/项目拆解 |
| 客户工单归因 Agent | analysis | 根因、问题类型、状态、项目分布 |
| 经营深度研究 Agent | analysis | 销售 + 工单 + 数据质量联合分析报告 |
| 企业知识问答 Agent | knowledge | 规则、指标、模板、术语引用 |
| AI 月报报告 Agent | report | 报告草稿、报告资产化、版本 |
| 经营风险与异常识别 Agent | risk | 项目风险排序、整改建议 |
| 数据画像 Agent | data | 字段画像、缺失率、样本、基数 |
| 数据质量 Agent | data | 规则运行、失败样本、结果持久化 |
| 指标语义治理 Agent | semantic | 指标、术语、模板、覆盖分析 |
| 分析面板生成 Agent | panel | 面板布局、组件数据物化 |
| Codex 工程嵌套 Agent | codex | 工程任务创建、审批、派发 |

## 数据能力

- 数据集：销售、工单、项目里程碑、数据日度宽表。
- 数据目录：数据源、数据集、字段、指标、同义词、血缘。
- 语义层：术语、指标口径、查询模板。
- 数据质量：规则、运行结果、失败样本。
- 面板：dashboard_panels + panel_widgets。
- 查询：只读 SQL Guard。
- 评测：覆盖问数、工单、风险、面板、Codex。
