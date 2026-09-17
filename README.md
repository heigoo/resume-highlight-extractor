# 简历亮点提炼工具（Resume Highlight Extractor）

[![CI](https://github.com/heigoo/resume-highlight-extractor/actions/workflows/ci.yml/badge.svg)](https://github.com/heigoo/resume-highlight-extractor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

把简历原文和目标岗位 JD 变成「可直接写进面试自我介绍」的亮点清单：AI 提炼 + 证据溯源 + 量化评分 + JD 对标缺口，全程本地运行，API Key 由你自己保管（BYOK）。

## 核心功能

- **AI 亮点提炼**：粘贴简历与 JD，按岗位预设（技术/产品/运营等）或自定义规则提炼，流式输出实时渲染
- **证据溯源**：每条亮点标注「源N」对应简历原文行；无依据的条目自动标记【待补】
- **量化评分**：弱动词、待补项、无数字表达、日期断档、JD 覆盖率多维扣分，0-100 分直观呈现
- **JD 对标缺口**：抽取 JD 高频关键词，计算命中率与缺口清单，点击直达对应卡片
- **版本库**：IndexedDB 本地版本管理，覆盖操作前自动快照，可随时回溯对比
- **双通道兜底**：未配置 AI 或转发不可用时，走「生成提炼指令 → 外部 AI → 结果回填」手动路径，功能不中断
- **多种导出**：一键复制 / 富文本 / Markdown / Word（.docx）/ 打印 PDF，支持整篇译成英文
- **文件解析**：直接上传 PDF / DOCX 简历，无需手动复制粘贴
- **暗色模式**：亮/暗/跟随系统三态切换

## 快速开始

环境要求：Node.js 18+

```bash
git clone https://github.com/heigoo/resume-highlight-extractor.git
cd resume-highlight-extractor
npm install
npm run dev
```

打开页面后点击右上角「连接 AI」，在设置面板填入你的模型服务信息：

| 字段 | 说明 |
|---|---|
| Base URL | OpenAI 兼容接口地址（以 `/v1` 结尾） |
| API Key | 你自己的密钥，仅保存在浏览器 localStorage |
| 模型 | 如 `deepseek-chat`、`kimi-k2` 等 |

内置服务商预设（点击自动填充）：

- DeepSeek（`https://api.deepseek.com/v1`）
- Kimi / Moonshot（`https://api.moonshot.cn/v1`）
- SiliconFlow 硅基流动（`https://api.siliconflow.cn/v1`）
- Ollama 本地模型（`http://127.0.0.1:11434/v1`，无需 Key）

也可以使用任何 OpenAI 兼容接口。没有 Key？使用备用手动路径：复制生成的提炼指令发给任意 AI，把返回结果粘贴回来即可格式化检查。

## 技术栈

- Vue 3 + TypeScript + Vite + Tailwind CSS 4
- pdf.js / mammoth：PDF 与 DOCX 简历解析
- docx：Word 导出
- Vitest（115+ 单测）+ Playwright（多视口 e2e）
- 火山引擎 IGA Pages Functions：服务端转发代理（`api/ai.js`，不落盘、不存储）

## 测试与构建

```bash
npm test        # Vitest 单元测试
npm run test:e2e # Playwright 端到端测试
npm run build   # 类型检查 + 生产构建
```

## 部署

适配 [火山引擎 IGA Pages](https://www.volcengine.com/)：`iga pages deploy` 即可部署（包含 `api/` 下的 Serverless 代理）。理论上任何支持静态托管 + Node Functions 的平台均可部署。

## 安全设计

- API Key 仅存于浏览器 localStorage，可选隐藏显示
- 代理服务不存储任何请求内容，仅做转发
- 安全边界：HTTPS 端点全量放行；HTTP 端点仅允许回环地址（本地 Ollama 场景）

## License

[MIT](LICENSE) © 2026 heigoo
