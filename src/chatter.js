/**
 * dsh-pet 文案引擎 — 零依赖纯 JS ESM 移植版。
 *
 * Verbatim port of @linxin666/dsh-pet (0.3.23):
 *  - src/chatter.ts         (STATUS_POOLS / TOOL_POOLS / TOOL_REMAINING_POOL /
 *                            toolCategory / toolArgHint / StatusVoice /
 *                            WhisperEngine / WHISPER_*_POOLS / pacing consts)
 *  - src/remarks.ts         (BUILTIN_REMARKS)
 *  - src/affinity.ts        (countedRemark 的池计数轮转)
 *  - src/event-projection.ts (displayToolName 压实 + 24 字符截断)
 *
 * 硬性约定（与原作一致）：每个池的第一条是 legacy 固定文案（有测试锁定），
 * 池顺序即源文件顺序，不可改动。全程轮转（round-robin），无 Math.random，
 * 时钟可注入。无 emoji；～ 是鲸鱼娘签名。voice.json 覆盖机制未移植。
 * @module chatter
 */

/** While a scene persists, its copy advances on this cadence (ms). */
export const STATUS_ROTATE_MS = 4000

/** Fixed-copy pools per status scene (first line = legacy wording). */
export const STATUS_POOLS = {
  prepare: [
    '准备开始',
    '撸起袖子开工啦',
    '新一轮，出发～',
    '打起精神，开干！',
    '整理一下桌面，开始吧',
    '氧气充满，下潜开始～',
    '热身完毕，跃跃欲试',
    '开工仪式感已就位',
  ],
  waiting: [
    '等待模型响应',
    '呼叫大脑中，请稍等',
    '信号发射中，等一个回音',
    '灵感正在路上～',
    '竖起耳朵等回复',
    '大脑在咕噜咕噜加载',
    '等它伸个懒腰再开口',
    '模型：来了来了',
    '等一个灵感砸中我',
    '滴——等待连线中',
    '它在组织语言，别催',
    '等它热身完毕',
    '灵感快递派送中',
    '屏住呼吸等回复',
  ],
  thinking: [
    '正在思考',
    '嗯……让我想一想',
    '脑内风暴进行中',
    '思绪咕噜咕噜冒泡',
    '灵光集结中～',
    '眉头一皱，认真分析',
    '左脑右脑一起开会',
    '答案正在浮出水面',
    '盘一下，盘一下逻辑',
    '让子弹再飞一会儿',
    '别催别催，在想呢',
    '大脑转起来了',
    '让我把线索捋一捋',
    '脑内跑火车中',
    '小脑瓜高速运转',
    '让我琢磨琢磨',
    '翻翻脑子里的藏书',
    '让我嚼一嚼这个问题',
    '脑子在煮咖啡，马上好',
    '思考的鱼游来了',
    '让我康康这里面的门道',
    '正在盘逻辑链',
    '思绪整理收纳中',
    '嗯？有点意思……',
    '让思路沉淀一下',
    '脑内弹幕飞速滚动',
  ],
  review: [
    '整理回复中',
    '把想法写下来',
    '组织语言中～',
    '落笔成文，请稍候',
    '字斟句酌中',
    '把答案装进信封里',
    '遣词造句打磨中',
    '把思绪码成整整齐齐的字',
    '奋笔疾书中',
    '把最好的表达挑出来',
    '文字排版美容师上线',
    '收尾润色一下下',
  ],
  toolResult: [
    '处理工具结果',
    '看看带回了什么',
    '消化一下刚到的结果',
    '结果解读中～',
    '验收工具的成果',
    '把线索拼接起来',
    '战利品清点中',
    '这份结果有点东西',
    '把新情报归档',
    '结果到手，继续前进',
  ],
  done: [
    '完成啦',
    '搞定收工～',
    '任务达成，耶！',
    '这一轮圆满完成',
    '顺利抵达终点',
    '收工！求摸摸奖励',
    '交差！下一位',
    '齐活，漂亮收官',
    '拿下！击掌～',
    '稳了，满分交卷',
    '搞定，去喝口水',
    '完工咯，转个圈圈',
    '这一轮，我们配合满分',
    '妥了妥了，收工收工',
  ],
  failed: [
    '执行失败',
    '哎呀，中途卡住了',
    '这一步没能走完',
    '被小石头绊倒了',
    '半路翻车了，揉揉膝盖',
    '出了点岔子，缓缓再来',
  ],
  toolFailed: [
    '工具执行失败',
    '工具闹脾气了，哄哄它',
    '哎呀，工具掉链子了',
    '这个工具今天不太听话',
    '工具翻车了，扶起来继续',
    '没跑通，再来一次',
    '工具：我罢工三秒钟',
    '这一步摔了一跤，没事',
  ],
  maxTokens: [
    '达到输出上限',
    '话说到一半被截断了',
    '字数用完了，喘口气',
    '一口气说太满，缓缓',
  ],
  interrupted: [
    '执行意外中断',
    '哎呀，被意外打断了',
    '半路踩了急刹车',
    '被迫停下，意犹未尽',
  ],
  blocked: [
    '等待继续',
    '在这里等你发令',
    '暂停待命，随时出发',
    '蹲一个继续的指令',
  ],
}

/** Per-family tool status pools. '{tool}'/'{hint}' interpolate per line. */
export const TOOL_POOLS = {
  read: [
    '正在使用 {tool}',
    '翻翻 {hint}',
    '读一下 {hint}',
    '让我康康这个文件',
    '逐行品味 {hint}',
    '翻阅资料中～',
    '瞄一眼 {hint}',
    '把文件摊开看一看',
    '认真研读 {hint}',
  ],
  write: [
    '正在使用 {tool}',
    '写写写，写 {hint}',
    '下笔中～',
    '码字呢，别催',
    '写下 {hint}',
    '落笔成章',
    '把想法存进 {hint}',
    '开写开写',
    '存个文件压压惊',
  ],
  edit: [
    '正在使用 {tool}',
    '改改 {hint}',
    '修修补补中',
    '润色一下 {hint}',
    '改两行，就两行',
    '补一刀 {hint}',
    '动动手指改一改',
    '精雕细琢 {hint}',
    '微调一下下',
  ],
  shell: [
    '正在使用 {tool}',
    '跑跑 {hint}',
    '敲几行命令试试',
    '命令行走起：{hint}',
    '使唤终端跑个腿',
    '终端全速运转中',
    '敲回车！{hint}',
    '让命令飞一会儿',
    '去终端里探个究竟',
  ],
  grep: [
    '正在使用 {tool}',
    '搜搜 {hint}',
    '找找匹配：{hint}',
    '关键词走你',
    '在代码里挖一挖',
    '检索小雷达启动',
    '顺着 {hint} 追下去',
    '掘地三尺找一找',
    '过滤筛选中～',
  ],
  find: [
    '正在使用 {tool}',
    '找找文件 {hint}',
    '寻宝中～',
    '文件在哪里呀',
    '找啊找啊找文件',
    '把 {hint} 揪出来',
    '查找模式中',
  ],
  ls: [
    '正在使用 {tool}',
    '列个清单看看',
    '看看目录里有啥',
    '目录走起～',
    '瞟一眼文件夹',
    '数数这里有几个文件',
  ],
  webSearch: [
    '正在使用 {tool}',
    '网上搜搜 {hint}',
    '网络冲浪中',
    '帮你问问互联网',
    '搜一圈 {hint}',
    '去外面的世界打听打听',
    '查找资料中～',
    '情报收集模式开启',
  ],
  webFetch: [
    '正在使用 {tool}',
    '抓个页面看看',
    '拉取 {hint}',
    '扒拉一下网页',
    '取点内容回来',
    '打开 {hint} 瞅瞅',
  ],
  mcp: [
    '正在使用 {tool}',
    '连一下外部服务',
    '喊个外援来',
    '接个工具用用',
    '问问插件小助手',
    '外部力量接入中',
  ],
  memory: [
    '正在使用 {tool}',
    '翻翻小本本',
    '回想一下之前的事',
    '在记忆里挖一挖',
    '提取记忆碎片～',
    '我们之前的约定是……',
  ],
  subagent: [
    '正在使用 {tool}',
    '派个小弟去跑腿',
    '小助手出动！',
    '交给分身去办',
    '多线作战，分身出击',
    '召唤队友支援',
    '集思广益中～',
  ],
  todo: [
    '正在使用 {tool}',
    '列个待办清单',
    '写个小计划',
    '待办安排得明明白白',
    '打个勾，继续',
    '把任务排排坐',
  ],
  browser: [
    '正在使用 {tool}',
    '开个浏览器看看',
    '网页操作小能手',
    '替你点点页面',
    '浏览器跑腿中',
  ],
  git: [
    '正在使用 {tool}',
    '提交一下代码',
    '版本控制走起',
    '管管仓库',
    '给改动安个家',
  ],
  ask: [
    '正在使用 {tool}',
    '问你个事儿',
    '请教一下下',
    '等等，我需要确认',
    '这个问题得你拍板',
  ],
  generic: [
    '正在使用 {tool}',
    '召唤 {tool} 出击',
    '{tool} 工作中',
    '借助 {tool} 的力量',
    '拜托 {tool} 一下',
    '{tool}，启动！',
  ],
}

/** Pools for the parallel-tools line; '{n}' interpolates the running count. */
export const TOOL_REMAINING_POOL = [
  '还有 {n} 个工具运行中',
  '{n} 路并进，分身们还在忙',
  '还有 {n} 位小助手在加班',
  '{n} 条战线同时推进中',
  '另 {n} 个工具在后台跑',
]

/** Map a raw tool name onto its copy family (working-activity style regexes). */
export function toolCategory(toolName) {
  const name = String(toolName ?? '').toLowerCase()
  if (/mem0|recall|memory/.test(name)) return 'memory'
  if (/subagent|workflow|ralph|agent|task/.test(name)) return 'subagent'
  if (/web_search|websearch|search_web|exa|brave|tavily/.test(name)) return 'webSearch'
  if (/fetch|browser|playwright|chrome/.test(name)) return 'webFetch'
  if (/grep|search|rg/.test(name)) return 'grep'
  if (/glob|find/.test(name)) return 'find'
  if (/^ls$|list_dir|list/.test(name)) return 'ls'
  if (/ask_user|ask/.test(name)) return 'ask'
  if (/todo|plan/.test(name)) return 'todo'
  if (/git/.test(name)) return 'git'
  if (/mcp__|mcp/.test(name)) return 'mcp'
  if (/read|open|load|describe|inspect/.test(name)) return 'read'
  if (/edit|patch|replace|rename/.test(name)) return 'edit'
  if (/write|create|save/.test(name)) return 'write'
  if (/run_code|bash|shell|terminal|exec|command|ssh/.test(name)) return 'shell'
  return 'generic'
}

/** Tool family → whisper category (chatter.ts whisperCategoryOf 的完整映射). */
const WHISPER_CATEGORY_MAP = {
  read: 'reading',
  grep: 'reading',
  find: 'reading',
  ls: 'reading',
  write: 'editing',
  edit: 'editing',
  shell: 'running',
  webSearch: 'searching',
  webFetch: 'searching',
  memory: 'searching',
  mcp: 'searching',
  git: 'git',
  subagent: 'delegating',
  todo: 'delegating',
  browser: 'browsing',
  ask: 'generic',
  generic: 'generic',
}

/** Map a tool family onto the whisper category it belongs to. */
export function whisperCategoryOf(family) {
  const mapped = WHISPER_CATEGORY_MAP[family]
  return typeof mapped === 'string' ? mapped : 'generic'
}

/** Murmur pacing: the cooldown between category whispers. */
export const WHISPER_COOLDOWN_MS = 9000
/** Outcome whispers get their own shorter cooldown so a real moment still speaks. */
export const WHISPER_RESULT_COOLDOWN_MS = 5000
/** How long a whisper stays on screen (host-side expiry). */
export const WHISPER_TTL_MS = 8000

/** Category-level inner-whisper pools — the pet knows roughly what is going on. */
export const WHISPER_CATEGORY_POOLS = {
  thinking: [
    '先在脑子里搭个框架',
    '它在心里打草稿，我垫着脚看',
    '思路在一颗一颗冒泡',
    '脑内开会中，都别抢话筒',
    '先想清楚，再动手不迟',
    '草稿纸已经画满了',
    '让我听听它下一步打算',
    '嗯，方案在成型了',
  ],
  writing: [
    '落笔成文，我旁边听着',
    '句子排着队往外走',
    '把想法一句句摆整齐',
    '它在组织语言，我打打气',
    '写回复呢，不催',
    '字斟句酌，快好了',
  ],
  reading: [
    '翻资料呢，我保持安静',
    '一行一行读，不跳页',
    '在纸堆里找线索',
    '眼珠子跟着字跑',
    '边读边做记号',
    '翻箱倒柜找重点',
  ],
  editing: [
    '动手改起来了，手稳一点',
    '这里补一笔，那边修一修',
    '在改东西，听不到声音才怪',
    '落笔小心，别有错别字',
    '改写的节奏，我听得见',
    '刷刷地改，一行都没跑',
  ],
  running: [
    '跑起来了跑起来了',
    '命令敲出去，等个回响',
    '在跑什么呢，我踮脚看',
    '输出开始冒烟了',
    '它在跑活，我不吵',
    '盯着输出，蹲一个结果',
    '这波跑完就靠它了',
  ],
  searching: [
    '去外面捞点信息',
    '翻翻记忆库，等我一小会儿',
    '顺着网线找线索',
    '把老账翻出来对一对',
    '情报在路上了',
    '搜索引擎当跑腿',
  ],
  git: [
    '版本在往前迈步',
    '改动排队上车',
    '提交历史在长个子',
    '分支合并，神清气爽',
    '记录都焊在时间线上',
  ],
  delegating: [
    '派了活儿出去，等回话',
    '清单列好，一件件来',
    '任务拆开分了组',
    '手下的伙计在远处跑着',
    '分工完毕，各司其职',
  ],
  browsing: [
    '它在看网页，我偷瞄两眼',
    '页面一张张翻过去',
    '网页里翻答案呢',
    '这网速，我先歇会儿',
  ],
  generic: [
    '这波活儿，我陪着',
    '又开工了，我盯梢',
    '它忙它的，我守着',
    '不打扰，就安静待着',
    '有活儿就有我',
  ],
}

/** The pet's outcome reactions — woken by structured session results only. */
export const WHISPER_RESULT_POOLS = {
  pass: [
    '全绿！亮瞎我眼了',
    '测试过了，击掌～',
    '绿灯一排排，看着就舒坦',
    '稳了稳了，这波稳得很',
    '全绿，奖励自己一口小鱼干',
    '这波测试，赢得干脆',
  ],
  fail: [
    '哎呀，踩到小石子了',
    '这报错我盯上它了',
    '别慌，先看它在喊什么',
    '修好它，今天才不算白干',
    '又一次踩坑，老熟人了',
    '问题不大，就是有点问题',
  ],
  done: [
    '搞定，收工～',
    '又翻过一页，踏实',
    '努力没白费，开心',
    '任务清零，舒服',
    '攻下一城，转个圈',
    '收工收工，今天圆满',
  ],
}

/** Built-in default remark library (remarks.ts BUILTIN_REMARKS, verbatim). */
export const BUILTIN_REMARKS = {
  pet: [
    '咕噜咕噜～被摸摸好舒服！',
    '再摸摸这里，痒痒的～',
    '头顶温度刚刚好，安心～',
    '被摸到耳朵啦，扑通扑通！',
    '你的手掌好温暖，舍不得你走～',
    '呼噜呼噜～就靠在这里不走了！',
    '今天的摸头也收货成功！',
    '蹭蹭你的手心，这是回礼～',
    '多摸摸我，亲密度会涨哦！',
    '闭眼享受中，请勿打扰～',
    '头再低一点，够不着了～',
    '呼噜呼噜，声音都冒出来了',
    '这手感，比小鱼干还上瘾',
    '摸到第三下，满意',
    '耳朵后面，别漏了……啊，舒服',
    '被摸得尾巴都卷起来了',
  ],
  petCooldown: [
    '摸过头啦，让鲸鱼娘歇口气～',
    '羽毛都快被摸秃啦，缓一缓～',
    '呼……先让我喘口气嘛！',
    '再摸就要睡着了哦～',
    '稍微休息一下，待会儿再摸～',
    '头顶要冒烟啦，停一停！',
    '我知道你喜欢我，但也要节制呀～',
    '歇一歇，摸摸的手感会更好哦～',
    '咕……等我回个蓝～',
    '让我先消化一下刚才的爱！',
    '痒痒的，先让我缓一下……',
    '再摸就掉线了，真的',
    '库存的呼噜声用完了',
    '手歇会儿，我也要补个蓝',
    '舒服归舒服，得缓缓呀',
    '再摸下去，我就要融化了',
  ],
  feed: [
    '呜哇！小鱼干好好吃！',
    '咔嚓咔嚓，美味到尾巴打结～',
    '这条小鱼干是刚晒好的，好香！',
    '谢谢你，胃里暖暖的～',
    '囤粮 +1，今天也有好好被爱！',
    '好吃到想转圈圈～',
    '小鱼干最好吃了，再来亿条！',
    '饱餐一顿，马上满血复活～',
    '这个味道，是幸福的味道！',
    '吃完了还不忘舔舔爪子～',
    '这小鱼干，是今天的顶配',
    '一口下去，精神头全回来了',
    '脆！香！就是这个味儿',
    '边吃边摇尾巴，形象不要了',
    '好吃到眼睛都眯起来了',
    '这块鱼干我记住了，懂我的',
  ],
  feedCooldown: [
    '吃饱啦，晚点再喂～',
    '肚子圆滚滚的，装不下啦～',
    '再喂就要变成球啦！',
    '让我慢慢消化这份心意～',
    '小鱼干的香气还没散呢～',
    '呼……满足得动不了了～',
    '先散步一圈再吃下一顿！',
    '肚皮已经鼓鼓的啦～',
    '好吃是好吃，可也得节制呀～',
    '等我饿了会告诉你哦～',
    '胃说它满了，脑子说还能吃',
    '这条得留着慢慢品',
    '先消消食，待会儿再战',
    '塞不下了，真塞不下了',
    '闻着香，可惜没地方放了',
    '嗝……这顿值了',
  ],
  noTreats: [
    '没有小鱼干了，多陪我工作一会儿吧～',
    '粮仓空空，陪我完成几轮任务就会有小鱼干啦～',
    '小鱼干在路上啦，先一起加油工作！',
    '嘴巴寂寞了……快去完成一轮任务！',
    '陪我多工作一会儿，鱼干自动到账～',
    '现在喂我也只会饿着肚子说谢谢哦～',
    '粮仓见底啦，用几轮任务换一条鱼干吧～',
    '饿着肚子等你完成下一轮任务～',
    '小鱼干藏在你的工作里，去找找看！',
    '先工作后干饭，我们的约定哦～',
    '粮仓见底，全靠感情撑着了',
    '饿是真饿，活也是真得干',
    '画饼充饥……不对，画鱼干充饥',
    '没鱼干的日子，靠意志力过',
    '下一轮任务，我闻到了鱼干味',
    '先记账上，欠我两条，记住啦',
  ],
}

/** Built-in reaction selected deterministically from a persisted counter (affinity.ts). */
export function countedRemark(pool, count) {
  return pool[Math.max(0, Math.floor(count)) % pool.length] ?? pool[0]
}

/** Keep tool names readable inside the compact status bubble (event-projection.ts). */
export function displayToolName(name) {
  const compact = String(name ?? '').replace(/\s+/g, ' ').trim() || '工具'
  return compact.length <= 24 ? compact : compact.slice(0, 21) + '...'
}

/** Per-family candidate argument keys for the hint (chatter.ts toolArgHint). */
function candidateKeysFor(family) {
  switch (family) {
    case 'shell': return ['command', 'code', 'cmd']
    case 'grep': return ['pattern', 'query', 'path']
    case 'find': return ['pattern', 'path', 'glob']
    case 'read': case 'write': case 'edit': return ['file_path', 'path', 'filePath', 'file']
    case 'webSearch': return ['query', 'q', 'keyword']
    case 'webFetch': case 'browser': return ['url', 'uri']
    case 'subagent': return ['description', 'label', 'prompt']
    case 'ls': return ['path', 'dir', 'directory']
    case 'git': return ['command', 'message']
    default: return ['command', 'query', 'path', 'file_path', 'description', 'title', 'name']
  }
}

/**
 * A compact, human-readable hint of what a tool call actually touches — the
 * command, the path, the pattern, the query. `argsJsonValue` accepts the raw
 * arguments JSON string or an already-parsed object. Best-effort; unknown
 * shapes stay hintless (undefined). Capped at 28 chars so the bubble stays
 * compact; read/write/edit hints keep only the path's last segment.
 */
export function toolArgHint(family, argsJsonValue) {
  let args = argsJsonValue
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args
  for (const key of candidateKeysFor(family)) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const compact = value.replace(/\s+/g, ' ').trim()
    if (compact === '') continue
    const base = compact.split('/').pop() ?? compact
    const shown = (family === 'read' || family === 'write' || family === 'edit') && base !== '' ? base : compact
    return shown.length <= 28 ? shown : shown.slice(0, 25) + '...'
  }
  return undefined
}

/**
 * Whether a tool invocation looks like a test run (chatter.ts, verbatim). The
 * whisper engine never reads the model's prose; a test mood is wanted only
 * when a test tool actually ran. `argsJsonValue` accepts a raw JSON string or
 * an already-parsed object.
 */
export function looksLikeTestTool(name, argsJsonValue) {
  const tool = String(name ?? '').toLowerCase()
  if (/(^|[\/_.-])(test|tests|spec|vitest|jest|pytest|mocha|playwright|cypress|karma)([\/_.-]|$)/.test(tool)) {
    return true
  }
  if (argsJsonValue === undefined || argsJsonValue === null) return false
  let raw
  let parsed
  if (typeof argsJsonValue === 'string') {
    raw = argsJsonValue
    try {
      parsed = JSON.parse(argsJsonValue)
    } catch {
      parsed = undefined
    }
  } else {
    raw = JSON.stringify(argsJsonValue)
    parsed = argsJsonValue
  }
  // Prefer the real command / code fields when the arguments parse; the raw
  // JSON fallback still catches model-produced shapes the parser misses.
  let haystack = raw.toLowerCase()
  if (typeof parsed === 'object' && parsed !== null) {
    const command = parsed.command
    const code = parsed.code
    const picked = typeof command === 'string' && command !== ''
      ? command
      : typeof code === 'string' && code !== ''
        ? code
        : undefined
    if (picked !== undefined) haystack = picked.toLowerCase()
  }
  return /\b(pnpm|npm|yarn|npx|bun|python)\s+(run\s+)?(test|tests?)\b/.test(haystack)
    || /\b(pytest|vitest|jest|mocha|cypress|playwright|go test|cargo test)\b/.test(haystack)
}

/**
 * Fill a copy template: {tool} / {hint} / {n}. When vars.hint is missing it
 * falls back to vars.tool (chatter.ts: hint ?? displayName). '{n}' is only
 * replaced when vars.n is provided.
 */
export function applyTemplate(t, vars = {}) {
  const tool = vars.tool ?? ''
  const hint = vars.hint ?? (vars.tool !== undefined ? vars.tool : '')
  let line = t.replaceAll('{tool}', tool)
  line = line.replaceAll('{hint}', hint)
  if (vars.n !== undefined) line = line.replaceAll('{n}', String(vars.n))
  return line
}

/**
 * Round-robin voice for status copy (chatter.ts StatusVoice, minus the
 * voice-pack override layer). Picks stay STABLE while the same scene repeats,
 * but advance once the scene has persisted past STATUS_ROTATE_MS, so a long
 * thinking stretch keeps changing its wording. Clock is injectable; defaults
 * to Date.now().
 */
export class StatusVoice {
  constructor(rotateMs = STATUS_ROTATE_MS) {
    this.rotateMs = rotateMs
    this.counters = new Map()
    this.lastScene = ''
    this.lastLine = ''
    this.lastLineAt = Number.NEGATIVE_INFINITY
  }

  /** Draw the next line of one pool, advancing its round-robin cursor. */
  draw(poolKey, pool) {
    const index = (this.counters.get(poolKey) ?? 0) % pool.length
    this.counters.set(poolKey, index + 1)
    return pool[index]
  }

  /** Reuse the stable line or advance when the cadence elapsed. */
  voice(scene, poolKey, pool, nowMs) {
    if (scene === this.lastScene && nowMs - this.lastLineAt < this.rotateMs) return this.lastLine
    this.lastScene = scene
    this.lastLine = this.draw(poolKey, pool)
    this.lastLineAt = nowMs
    return this.lastLine
  }

  /** Status line for a phase scene. */
  line(scene, nowMs = Date.now()) {
    return this.voice('scene:' + scene, 'pool:' + scene, STATUS_POOLS[scene], nowMs)
  }

  /** Status line for a tool call, with the real-argument hint when known. */
  toolLine(family, tool, hint, nowMs = Date.now()) {
    const pool = Array.isArray(TOOL_POOLS[family]) ? TOOL_POOLS[family] : TOOL_POOLS.generic
    const line = this.voice('tool:' + family, 'tool:' + family, pool, nowMs)
    return applyTemplate(line, { tool, hint })
  }

  /** Status line while sibling tools still run (always reflects the count). */
  remaining(n, nowMs = Date.now()) {
    const line = this.voice('toolRemaining', 'toolRemaining', TOOL_REMAINING_POOL, nowMs)
    return applyTemplate(line, { n })
  }
}

/**
 * The murmur engine (碎碎念, chatter.ts WhisperEngine, minus the voice-pack
 * override layer): category lines woken by the situation, outcome lines woken
 * by structured session results. Cooldowns keep whispers occasional; picks
 * are round-robin so tests reproduce exact lines. Returns the whisper to show
 * or null when the moment stays quiet (cooldown). Clock injectable.
 */
export class WhisperEngine {
  constructor(categoryCooldownMs = WHISPER_COOLDOWN_MS, resultCooldownMs = WHISPER_RESULT_COOLDOWN_MS) {
    this.categoryCooldownMs = categoryCooldownMs
    this.resultCooldownMs = resultCooldownMs
    this.categoryCursor = new Map()
    this.resultCursor = new Map()
    this.lastWhisperAt = Number.NEGATIVE_INFINITY
  }

  /**
   * Feed one situation while a session works. Returns the whisper to show,
   * or null when the moment stays quiet (cooldown).
   */
  feed(category, nowMs = Date.now()) {
    if (nowMs - this.lastWhisperAt < this.categoryCooldownMs) return null
    const pool = WHISPER_CATEGORY_POOLS[category]
    if (!Array.isArray(pool) || pool.length === 0) return null
    const index = (this.categoryCursor.get(category) ?? 0) % pool.length
    this.categoryCursor.set(category, index + 1)
    return this.speak(pool[index], nowMs)
  }

  /**
   * Feed one structured outcome (test green / tool failure / completion).
   * Outcomes carry their own shorter cooldown so the emotional moment is
   * heard unless another whisper just spoke. Returns text or null.
   */
  result(kind, nowMs = Date.now()) {
    if (nowMs - this.lastWhisperAt < this.resultCooldownMs) return null
    const pool = WHISPER_RESULT_POOLS[kind]
    if (!Array.isArray(pool) || pool.length === 0) return null
    const index = (this.resultCursor.get(kind) ?? 0) % pool.length
    this.resultCursor.set(kind, index + 1)
    return this.speak(pool[index], nowMs)
  }

  speak(line, nowMs) {
    this.lastWhisperAt = nowMs
    return line
  }
}

/* ------------------------------------------------------------------ *
 * 自检：node src/chatter.js 直接运行。                              *
 * ------------------------------------------------------------------ */
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('chatter.js')) {
  const sizes = (pools) => Object.entries(pools).map(([k, v]) => `${k}=${v.length}`).join(' ')
  const total = (pools) => Object.values(pools).reduce((s, v) => s + v.length, 0)
  console.log('=== dsh-pet chatter.js 自检 ===')
  console.log(`STATUS_POOLS          ${Object.keys(STATUS_POOLS).length} 场景, ${total(STATUS_POOLS)} 条 | ${sizes(STATUS_POOLS)}`)
  console.log(`TOOL_POOLS            ${Object.keys(TOOL_POOLS).length} 家族, ${total(TOOL_POOLS)} 条 | ${sizes(TOOL_POOLS)}`)
  console.log(`TOOL_REMAINING_POOL   ${TOOL_REMAINING_POOL.length} 条`)
  console.log(`WHISPER_CATEGORY_POOLS ${Object.keys(WHISPER_CATEGORY_POOLS).length} 类, ${total(WHISPER_CATEGORY_POOLS)} 条 | ${sizes(WHISPER_CATEGORY_POOLS)}`)
  console.log(`WHISPER_RESULT_POOLS  ${total(WHISPER_RESULT_POOLS)} 条 | ${sizes(WHISPER_RESULT_POOLS)}`)
  console.log(`BUILTIN_REMARKS       ${Object.keys(BUILTIN_REMARKS).length} 组, ${total(BUILTIN_REMARKS)} 条 | ${sizes(BUILTIN_REMARKS)}`)
  console.log(`consts: STATUS_ROTATE_MS=${STATUS_ROTATE_MS} WHISPER_COOLDOWN_MS=${WHISPER_COOLDOWN_MS} WHISPER_RESULT_COOLDOWN_MS=${WHISPER_RESULT_COOLDOWN_MS} WHISPER_TTL_MS=${WHISPER_TTL_MS}`)

  console.log('\n-- StatusVoice 轮转（注入时钟, rotateMs=4000）--')
  const voice = new StatusVoice()
  console.log('t=0     line(thinking)   :', voice.line('thinking', 0))
  console.log('t=1000  line(thinking)   :', voice.line('thinking', 1000), '(<4s 同场景 → 同一句)')
  console.log('t=5000  line(thinking)   :', voice.line('thinking', 5000), '(≥4s → 轮转)')
  console.log('t=6000  toolLine(shell)  :', voice.toolLine('shell', 'pwsh', 'npm test', 6000))
  console.log('t=7000  toolLine(shell)  :', voice.toolLine('shell', 'pwsh', 'pnpm build', 7000), '(同家族 <4s → 句稳但 hint 跟手)')
  console.log('t=8000  remaining(3)     :', voice.remaining(3, 8000))
  console.log('t=13000 remaining(5)     :', voice.remaining(5, 13000))

  console.log('\n-- WhisperEngine 冷却（category 9s / result 5s）--')
  const whispers = new WhisperEngine()
  console.log('t=0      feed(thinking)   :', whispers.feed('thinking', 0))
  console.log('t=1000   feed(running)    :', whispers.feed('running', 1000), '(冷却中 → null)')
  console.log('t=10000  feed(running)    :', whispers.feed('running', 10000))
  console.log('t=10500  result(pass)     :', whispers.result('pass', 10500), '(result 冷却 → null)')
  console.log('t=16000  result(pass)     :', whispers.result('pass', 16000))
  console.log('t=17000  result(pass)     :', whispers.result('pass', 17000), '(<5s → null)')

  console.log('\n-- 杂项 --')
  console.log('displayToolName 24 截断 :', displayToolName('mcp__github__create_pull_request_review_comment'))
  console.log('toolCategory(read_file) :', toolCategory('read_file'), '| whisperCategoryOf(read) :', whisperCategoryOf('read'))
  console.log('toolArgHint(read)       :', toolArgHint('read', { file_path: 'src/components/Pet/Bubble.tsx' }))
  console.log('looksLikeTestTool         :', looksLikeTestTool('pwsh', { command: 'pnpm test' }), looksLikeTestTool('pwsh', { command: 'pnpm build' }))
  console.log('countedRemark(pet, 17)  :', countedRemark(BUILTIN_REMARKS.pet, 17))
  console.log('applyTemplate             :', applyTemplate('还有 {n} 个工具运行中', { n: 2 }))
}
