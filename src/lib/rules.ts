import { recordLines, splitRecordSegments } from './parse'

export const DEFAULT_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 动词开头 + 做了什么 + 带来的结果，材料里有数字的必须保留；',
  '3. 「负责 / 参与 / 协助 / 跟进」这类弱动词，替换成能体现动作和主导性的具体表达；',
  '4. 过滤过程性、事务性描述（联调、开会、改配置、日常维护），保留能体现技术能力和结果的事；',
  '5. 内部系统名、项目代号、客户名称一律泛化成行业通用说法，不要原样出现；',
  '6. 每条亮点下面附一行「面试展开点」：这条背后的技术取舍或难点，提示我准备口述细节。',
].join('\n')

const BUSINESS_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 动词开头 + 做了什么 + 带来的结果，材料里有数字的必须保留；',
  '3. 优先呈现推动、落地、协同类的主动行为，避免「负责 / 参与 / 协助」这类被动表述；',
  '4. 保留跨角色协作与推进类事项（需求沟通、方案对齐、跨团队配合），说明你在其中承担的角色；',
  '5. 结果优先从业务视角描述：效率、体验、稳定性、覆盖面，而不是纯技术指标；',
  '6. 过滤纯事务性描述（改配置、日常维护），内部系统名、项目代号一律泛化成行业通用说法。',
].join('\n')

const BACKEND_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 动词开头 + 做了什么 + 带来的结果，材料里有数字的必须保留；',
  '3. 优先呈现架构设计、性能与稳定性工作（吞吐、延迟、可用性、故障恢复），量化指标放在句尾突出位置；',
  '4. 「负责 / 参与 / 协助」这类弱动词，替换成体现主导性和技术决策的表达；',
  '5. 过滤常规事务（值班巡检、例行发布、会议沟通），内部系统名、项目代号一律泛化成行业通用说法；',
  '6. 每条亮点下面附一行「面试展开点」：这条背后的技术取舍或难点，提示我准备口述细节。',
].join('\n')

const ALGO_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 动词开头 + 做了什么 + 带来的结果，材料里有数字的必须保留；',
  '3. 优先呈现数据规模、实验设计与效果对比（样本量、AB 实验、准确率 / 召回 / 转化提升），基线和提升幅度都要写清；',
  '4. 弱动词替换成体现方法论的动作（构建、设计、调优、验证），过滤取数、跑脚本这类过程性描述；',
  '5. 内部数据表名、模型代号一律泛化成行业通用说法；',
  '6. 每条亮点下面附一行「面试展开点」：这条背后的方法取舍或踩过的坑，提示我准备口述细节。',
].join('\n')

const PRODUCT_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 动作 + 场景 / 痛点 + 可量化的业务结果，材料里有数字的必须保留；',
  '3. 优先呈现从需求洞察到落地的完整闭环（发现问题 → 方案 → 推动上线 → 数据验证）；',
  '4. 避免「配合 / 参与」等被动词，改用「定义、推动、落地、验证」等主动表达；',
  '5. 过滤纯执行事务（写文档、排期维护），内部项目代号泛化成业务说法；',
  '6. 每条亮点下面附一行「面试展开点」：这个决策背后的权衡或数据依据，提示我准备口述细节。',
].join('\n')

const OPS_RULES = [
  '1. 只基于我给的材料，不要补写或推测没有的信息；缺关键结果数据的，用【待补：具体补什么】标出来让我确认；',
  '2. 每条亮点 = 策略 / 动作 + 渠道或对象 + 量化结果（留存、转化、GMV、增长率），数字必须保留；',
  '3. 优先呈现可复用的方法论（活动机制、增长打法、渠道策略），而不是单次执行；',
  '4. 弱动词替换成「策划、搭建、拉通、撬动」等体现主导性的表达；',
  '5. 过滤纯执行事务（改文案、例行推送），内部活动代号泛化成通用说法；',
  '6. 每条亮点下面附一行「面试展开点」：这个打法为什么有效，提示我准备口述细节。',
].join('\n')

export interface RulePreset {
  id: string
  label: string
  rules: string
}

export const RULE_PRESETS: RulePreset[] = [
  { id: 'tech', label: '前端技术岗', rules: DEFAULT_RULES },
  { id: 'backend', label: '后端技术岗', rules: BACKEND_RULES },
  { id: 'algo', label: '算法 / 数据岗', rules: ALGO_RULES },
  { id: 'product', label: '产品经理', rules: PRODUCT_RULES },
  { id: 'ops', label: '运营 / 增长', rules: OPS_RULES },
  { id: 'business', label: '偏业务方向', rules: BUSINESS_RULES },
]

export interface ComposePromptOptions {
  /** 目标岗位 JD 原文；非空时注入「对标 JD」规则段 */
  jd?: string
  /** 表达风格预设 id（STYLE_PRESETS）；空字符串为默认风格 */
  style?: string
  /** 人群场景预设 id（SCENARIO_PRESETS）；空字符串为不指定 */
  scenario?: string
}

// 表达风格库：与岗位规则正交的第二维度，附加在规则之后
export interface StylePreset {
  id: string
  label: string
  instruction: string
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'classic', label: '默认', instruction: '' },
  {
    id: 'star',
    label: 'STAR 叙事',
    instruction:
      '每条亮点按「情境-任务-行动-结果」压缩成一句话：先交代背景与目标，再突出你的动作与量化结果，删掉所有铺垫性描写。',
  },
  {
    id: 'xyz',
    label: 'XYZ 法则',
    instruction:
      '每条亮点套用「完成了 X，通过 Y 手段，带来 Z 结果」句式；Z 必须量化（百分比/金额/时长/规模），没有数字的用【待补】标注。',
  },
  {
    id: 'quantify',
    label: '量化优先',
    instruction:
      '把所有能量化的表述前置：数字、对比、规模放在句首或句尾最显眼的位置；纯定性描述压缩成半句，给数字让位。',
  },
  {
    id: 'verbs',
    label: '动词引领',
    instruction:
      '每条亮点以强动词开头（主导、搭建、重构、推动、落地、自动化），句式紧凑；同一动词不要连续出现在两条里。',
  },
  {
    id: 'bilingual',
    label: '中英对照',
    instruction:
      '每条亮点写成「中文表达 / English translation」，中英文同一条内用「 / 」分隔，英文用简历惯用的动作动词开头，控制在两行内。',
  },
]

export function styleInstruction(styleId: string | undefined): string {
  if (!styleId) return ''
  return STYLE_PRESETS.find((s) => s.id === styleId)?.instruction ?? ''
}

// 原始记录逐行编号（1 | 内容）：让模型照抄左侧编号，而不是自己数行号。
// 实测推理型模型常把「行号」理解成条目序号，导致「源N」指到不相干的行。
export function numberRecords(records: string): string {
  return recordLines(records)
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n')
}

// 人群场景库：与岗位规则 / 表达风格正交的第三维度，针对不同人群的痛点引导
export interface ScenarioPreset {
  id: string
  label: string
  instruction: string
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  { id: '', label: '通用', instruction: '' },
  {
    id: 'fresh',
    label: '应届无经验',
    instruction:
      '我缺少正式工作经历：请把课程项目、社团/组织经历、竞赛与自学实践里的可迁移能力提炼出来（组织协调、快速学习、从零落地），弱化「实习期短」的观感，不虚构任何职位与产出。',
  },
  {
    id: 'switch',
    label: '转行',
    instruction:
      '我正在转行：请突出可迁移能力（学习方法、跨领域协作、上手速度）与主动补课的证据（自学项目、练习成果），把原行业经历翻译成目标岗位听得懂的语言；不虚构目标行业的工作经历。',
  },
  {
    id: 'gap',
    label: '空窗期',
    instruction:
      '我有一段职业空窗期：如实呈现即可，不要掩盖时间；重点强调空窗期间的沉淀（学习、项目、复盘）与当前的就绪状态，把「空窗」转成「蓄力」的叙事，不编造在职经历。',
  },
]

export function scenarioInstruction(scenarioId: string | undefined): string {
  if (!scenarioId) return ''
  return SCENARIO_PRESETS.find((s) => s.id === scenarioId)?.instruction ?? ''
}

export function composePrompt(
  records: string,
  rules: string,
  options: ComposePromptOptions = {},
): string {
  const jdBlock = options.jd?.trim()
    ? `\n\n目标岗位 JD（用于关键词对标，不要照抄，要把命中关键词自然融入亮点表达）：\n${options.jd.trim()}`
    : ''
  const styleBlock = styleInstruction(options.style)
    ? `\n\n表达风格：${styleInstruction(options.style)}`
    : ''
  const scenarioBlock = scenarioInstruction(options.scenario)
    ? `\n\n人群场景：${scenarioInstruction(options.scenario)}`
    : ''
  // 多段记录（--- 分隔）时要求按段归属，避免把不同项目/公司的成果混写成一条
  const segmentCount = splitRecordSegments(records).length
  const segmentBlock =
    segmentCount > 1
      ? `\n8. 原始记录已按「---」分成 ${segmentCount} 段（多半是不同项目或公司）：每条亮点只归入其中一段的事，不要把不同段的成果混写成一条；确属跨段同一件事的可以合并，但「源N」要列全。`
      : ''
  return `你是我的简历顾问。下面是我最近的工作记录，请提炼成能写进简历的项目亮点，供我筛选。

规则：
${rules}
7. 每条亮点末尾标注出处，格式为「源N」或「源N,M」——N、M 直接抄下面「原始记录」每行左侧的数字（不要自己另数一遍）；跨行的亮点列出全部相关编号；找不到出处的不许标，也不要凭空生成亮点。${segmentBlock}${jdBlock}${styleBlock}${scenarioBlock}

输出格式：按「新增能力 / 优化提升 / 问题修复」三组，每组 2~4 条，Markdown 列表。每条亮点一行，下方可附一行「面试展开点：……」；不要寒暄、不要额外说明，直接输出列表。

原始记录（左侧数字即行号，标注「源N」时照抄）：
${numberRecords(records)}`
}

// 单条重写：只改表达不改事实，供结果区的「换个说法」
export function composeRewritePrompt(item: string): string {
  return `你是我的简历顾问。下面这条简历亮点表达不够好，请重写一遍。

要求：
1. 只改表达，不改事实：数字、专有动作、范围一律保留，不得新增原文没有的成果或数据；
2. 动词开头、突出动作与结果，避免「负责 / 参与 / 协助」这类弱动词；
3. 若缺关键数据，句尾用【待补：具体补什么】标注；
4. 只输出重写后的这一条亮点，不要解释、不要加引号或序号。

原始亮点：
${item}`
}

// 补充提炼：上一轮遗漏的 JD 关键词，定向再审一遍原始记录；找不到素材必须明说
export function composeSupplementPrompt(records: string, missingKeywords: string[]): string {
  return `你是我的简历顾问。此前已提炼过一轮简历亮点，但目标岗位 JD 的这些关键词还没有被覆盖：${missingKeywords.join('、')}。

请重新审读下面的原始记录：若其中有能体现这些关键词的工作内容，生成对应的补充亮点；若确实没有相关素材，不要编造，直接输出「无相关素材」四个字。

要求：
1. 每条亮点末尾标注出处「源N」（N 直接抄下面原始记录每行左侧的数字，不要自己另数），找不到出处的不许输出该条；
2. 动词开头 + 做了什么 + 结果，材料里的数字必须保留；
3. 只输出新增的补充亮点（Markdown 列表，按「新增能力 / 优化提升 / 问题修复」分组），不要重复已有内容；若无素材只输出「无相关素材」。

原始记录（左侧数字即行号）：
${numberRecords(records)}`
}

// 面试追问：基于当前勾选条目（可带 JD）生成 HR 最可能追问的问题，聚焦真实性自检
export function composeInterviewPrompt(items: string[], jd?: string): string {
  const list = items.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const jdBlock = jd?.trim()
    ? `\n\n目标岗位 JD（仅用于让提问贴近岗位场景，不得虚构 JD 里没有的经历或数据）：\n${jd.trim()}`
    : ''
  return `你是资深面试官。下面是我准备写进简历的亮点条目，请只针对这些内容，生成 5 个面试官最可能追问的问题。

要求：
1. 只针对上面列出的条目提问，不得虚构我没有写过的经历、岗位背景或数据；
2. 优先围绕：数字与结果的来源、个人贡献与分工边界、难点与解决方案、目标与取舍；
3. 每个问题单独一行，以「N. 」开头，句末用「（关联：第X条）」标注最相关的条目编号（可多个，用逗号分隔）；
4. 只输出问题列表，不要答案、不要解释、不要标题。${jdBlock}

亮点条目：
${list}`
}

// 面试模拟点评：候选人自答后给出可执行的反馈，只用他给出的信息，不编造
export function composeInterviewFeedbackPrompt(
  question: string,
  item: string,
  answer: string,
): string {
  const context = item.trim() === '' ? '（这条问题没有标注关联亮点）' : item
  return `你是资深面试官。候选人准备把下面的亮点写进简历，并回答了一个追问。请给出可直接执行的点评，不要客套、不要复述问题。

简历亮点：${context}
追问：${question}
候选人的回答：${answer}

点评要求（4 行以内，每行以「· 」开头）：
1. 是否答到点上：有没有覆盖问题真正想验证的东西（数字来源、个人分工、难点与解法、取舍依据）；
2. 与简历是否一致：回答里的数字 / 事实与亮点不一致或明显夸大的，直接指出；
3. 还缺什么：需要补充的具体细节（数据、背景、你个人的贡献边界）；
4. 全程只使用候选人给出的信息，不得编造新数据或新经历；如给示范表达，也只重排他已有的内容。`
}

// 追问细节 · 第一步：针对单条亮点，生成 2-3 个补强问题（数字/结果/分工/难点）
export function composeDetailAskPrompt(item: string, sourceLines: string[]): string {
  const material = sourceLines.length
    ? `\n\n这条亮点对应的原始记录：\n${sourceLines.map((l) => `- ${l}`).join('\n')}`
    : ''
  return `你是我的简历顾问。下面这条简历亮点信息偏薄（缺数字、结果或分工细节），请提出 2-3 个问题帮我补全，让我口头回答后你再改写成更强的表达。

要求：
1. 只针对这条亮点和相关原始记录提问，不要虚构经历或数据；
2. 问题聚焦：具体数字（数量/比例/耗时/规模）、结果影响、我的个人分工边界、遇到的难点与解法；
3. 每个问题单独一行，以「N. 」开头，问题要具体、可直接回答，不要问「还有什么要补充的」这类空泛问题；
4. 只输出问题列表，不要答案、不要解释。

亮点：${item}${material}`
}

// 追问细节 · 第二步：结合「原记录 + 用户回答」重写这一条；数字必须可溯源
export function composeDetailFillPrompt(
  item: string,
  sourceLines: string[],
  answers: string,
): string {
  const material = sourceLines.length
    ? `\n\n原始记录（事实来源，不得超出它的范围）：\n${sourceLines.map((l) => `- ${l}`).join('\n')}`
    : ''
  return `你是我的简历顾问。请结合「原始记录」与「我的回答」，把下面这条简历亮点改写得更具体、更有说服力。

要求：
1. 只能使用原始记录与我的回答里出现过的事实与数字，不得新增、推测或夸大任何数据；数字只能用我回答过的；
2. 动词开头 + 做了什么 + 结果，避免「负责 / 参与 / 协助」这类弱动词；
3. 我回答里没给到的关键数据，用【待补：具体补什么】标注，不要凭空填；
4. 只输出改写后的这一条亮点（一行），不要序号、引号、出处标记或任何解释。

原始亮点：${item}${material}

我的回答：
${answers}`
}

// 中英翻译：面向海外/外企投递，只翻译表达不改事实
export function composeTranslatePrompt(text: string): string {
  return `你是简历翻译专家。请把下面这份中文简历亮点翻译成英文（用于海外 / 外企投递）。

要求：
1. 逐条对应翻译，保留 Markdown 分组标题与列表结构，不要增删条目；
2. 每条用简历惯用的英文动作动词开头（Led / Built / Improved / Automated 等），时态统一用一般过去时；
3. 不虚构任何信息：数字、范围、专有名词一律与原中文保持一致；
4. 只输出译文，不要注释、不要双语对照、不要解释。

中文亮点：
${text}`
}

// 让 AI 根据原始记录判断岗位方向，现场生成一套提炼规则
export function composeRulePrompt(records: string): string {
  return `你是资深简历顾问。根据下面的原始工作记录，判断最可能的求职岗位方向，并为其定制一套「项目亮点提炼规则」。

要求：
1. 输出 6 条规则，每条一行，以「N. 」开头；
2. 必须覆盖：真实性边界（缺数据用【待补：具体补什么】标注）、亮点句式、该岗位最看重的表达侧重点、需要过滤的内容、内部名称泛化、面试展开点；
3. 针对记录反映的岗位定制侧重，不要输出通用套话；
4. 只输出规则列表，不要任何解释、标题或代码块。

原始记录：
${records}`
}

// 把 JD 拆成关键词与技能短语：英文按 token，中文用 2-6 字 n-gram 词频
const STOPWORDS = new Set([
  '的', '了', '和', '与', '及', '或', '在', '为', '等', '上', '下', '有', '能', '可', '以',
  '熟悉', '了解', '掌握', '具备', '优先', '加分', '优秀', '良好', '扎实', '熟练', '精通',
  '负责', '参与', '协助', '要求', '岗位', '职位', '描述', '我们', '团队', '公司', '项目',
  '相关', '工作', '经验', '能力', '学历', '专业', '应届', '全职', '兼职', '实习',
])

export interface JdKeywords {
  /** JD 中出现的技术 / 业务关键词，去重、去停用词 */
  terms: string[]
}

// 从 JD 文本中抽取候选关键词，按出现频次降序
export function extractJdKeywords(jd: string): JdKeywords {
  const text = jd.replace(/```[a-z]*\n?/gi, '').replace(/[（）()「」『』【】\[\]]/g, ' ')
  const counts = new Map<string, number>()

  // 英文：2-32 字母数字 / + # . - 序列（如 React、Node.js、C++、GPT-4），出现一次也保留
  const enPattern = /[A-Za-z][A-Za-z0-9+#./_-]{1,31}/g
  for (const w of text.matchAll(enPattern)) {
    const word = w[0].toLowerCase()
    if (word.length < 2) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }

  // 中文：在连续汉字片段内滑窗取 2-6 字 n-gram；中文无词边界，
  // 只保留重复 ≥2 次的片段（JD 里反复强调的才是真关键词，跨词垃圾片段不会重复）
  const cnPattern = /[\u4e00-\u9fa5]{2,}/g
  for (const run of text.matchAll(cnPattern)) {
    const s = run[0]
    for (let len = 2; len <= 6; len += 1) {
      for (let i = 0; i + len <= s.length; i += 1) {
        const gram = s.slice(i, i + len)
        if (STOPWORDS.has(gram)) continue
        counts.set(gram, (counts.get(gram) ?? 0) + 1)
      }
    }
  }

  const terms = [...counts.entries()]
    .filter(([word, count]) => (/[a-z]/.test(word) ? true : count >= 2))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    // 过滤被更长候选词包含的短词（如「优化」被「性能优化」包含时丢弃）
    .filter((word, _i, arr) => !arr.some((o) => o !== word && o.length > word.length && o.includes(word)))

  return { terms: terms.slice(0, 40) }
}

// 单条文本是否命中关键词（英文忽略大小写）
export function matchKeyword(text: string, keyword: string): boolean {
  const kw = keyword.trim()
  if (kw === '') return false
  const pattern = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return pattern.test(text)
}

// 全部亮点文本 vs 关键词清单的命中情况
export function matchKeywords(
  texts: string[],
  keywords: string[],
): { hit: string[]; miss: string[] } {
  const hit: string[] = []
  const miss: string[] = []
  for (const kw of keywords) {
    if (texts.some((t) => matchKeyword(t, kw))) hit.push(kw)
    else miss.push(kw)
  }
  return { hit, miss }
}

// 缺口分组：硬技能（技术/工具/方法类）与软能力（沟通/协作/素质类）
// 轻量启发式：含英文/数字，或命中技术词库 → 硬技能；其余归软能力。不新增 AI 调用
const HARD_SKILL_HINTS = [
  '开发', '架构', '接口', '性能', '数据', '算法', '模型', '部署', '测试', '代码',
  '前端', '后端', '服务', '系统', '工程', '自动化', '监控', '日志', '数据库', '框架',
  '安全', '运维', '分析', '统计', '实验', '指标', '平台', '工具', '设计', '优化',
]

export function groupJdGaps(miss: string[]): { hard: string[]; soft: string[] } {
  const hard: string[] = []
  const soft: string[] = []
  for (const kw of miss) {
    if (/[a-z0-9+#]/i.test(kw) || HARD_SKILL_HINTS.some((h) => kw.includes(h))) hard.push(kw)
    else soft.push(kw)
  }
  return { hard, soft }
}

// ---------- 规则 JSON 导入导出（可分享给同伴） ----------
export interface RulesFile {
  kind: 'rhe-rules'
  version: 1
  rules: string
}

export function serializeRules(rules: string): string {
  const payload: RulesFile = { kind: 'rhe-rules', version: 1, rules }
  return JSON.stringify(payload, null, 2)
}

// 兼容两种来源：本工具导出的 JSON，或直接分享的规则纯文本（≥3 条规则行才接受）
export function parseRules(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    const data = JSON.parse(trimmed) as { rules?: unknown }
    if (typeof data.rules === 'string' && data.rules.trim() !== '') return data.rules.trim()
    return null
  } catch {
    const cleaned = sanitizeRules(trimmed)
    const lines = cleaned.split('\n').filter((l) => l.trim() !== '')
    return lines.length >= 3 ? cleaned : null
  }
}

// 清洗 AI 返回的规则：去代码块围栏，尽量只保留规则行
export function sanitizeRules(text: string): string {
  const lines = text
    .replace(/```[a-z]*\n?/gi, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const rules = lines.filter((l) => /^\d+\s*[.、)]/.test(l) || /^[-*•]/.test(l))
  return (rules.length >= 3 ? rules : lines).join('\n')
}
