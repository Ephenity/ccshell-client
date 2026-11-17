type Slot = 'lateNight' | 'early' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'

const BY_SLOT: Record<Slot, string[]> = {
  lateNight: [
    '夜深了，{name}',
    '这么晚还在忙，{name}？',
    '夜里安静，适合把事情想清楚',
    '{name}，处理完这件，早些休息',
    '深夜了，有什么还没放下？',
    '夜深人静，慢慢来',
    '{name}，凌晨的思路往往更清晰',
    '这个时间还在琢磨什么，{name}？',
    '夜深了，先把要紧的理一理',
    '{name}，别熬得太晚',
    '夜里时间长，不必着急',
    '{name}，今晚还剩哪一件？',
    '安静的时候，适合做细致的事',
    '凌晨好，{name}'
  ],
  early: [
    '早，{name}',
    '清晨好，{name}',
    '起得很早，{name}',
    '{name}，今天先从哪里开始？',
    '天刚亮，思路正清楚',
    '早安，{name}。今天有什么安排？',
    '清早的时间最安静',
    '趁着清早，把今天理一理',
    '新的一天，{name}',
    '{name}，先从一件小事做起',
    '早起的人，时间更从容',
    '{name}，今天想先完成什么？',
    '晨光正好，开始吧',
    '早安，{name}'
  ],
  morning: [
    '早上好，{name}',
    '上午好，{name}',
    '{name}，今天的计划是什么？',
    '上午精力最好，适合啃难题',
    '{name}，先处理最重要的那件',
    '早上好。今天想做些什么？',
    '{name}，上午有什么要推进的？',
    '一天刚开始，不妨列个清单',
    '{name}，今天有什么要弄清楚的？',
    '上午好。从哪个问题说起？',
    '{name}，新的一天，按部就班',
    '精神正好，开始吧，{name}',
    '{name}，昨天的事还有没收尾的吗？',
    '上午适合专注做一件事',
    '{name}，先定一个今天的目标',
    '早上好。手头最急的是什么？',
    '{name}，今天也稳步向前',
    '一日之计在于晨，{name}'
  ],
  noon: [
    '中午好，{name}',
    '{name}，记得按时吃饭',
    '午间稍作休息，再继续',
    '{name}，上午的进度还顺利吗？',
    '中午了，先歇一歇',
    '{name}，午饭后再接着来',
    '忙了一上午，辛苦了，{name}',
    '中午好。下午打算做些什么？',
    '{name}，趁午间理一理思路',
    '午休之前，还有什么要收尾？',
    '{name}，别忘了吃午饭',
    '中午时间短，挑件轻松的事',
    '{name}，休息一下也是效率',
    '午安，{name}'
  ],
  afternoon: [
    '下午好，{name}',
    '{name}，下午有什么安排？',
    '午后容易犯困，先喝杯水',
    '{name}，下午想推进哪件事？',
    '下午好。从哪里接着做？',
    '{name}，上午留下的问题，现在看看？',
    '下午适合处理细节',
    '{name}，今天过半了，进展如何？',
    '午后时光，适合慢慢打磨',
    '{name}，还有什么卡住的地方？',
    '下午好。有什么需要一起梳理的？',
    '{name}，今天还剩哪些要完成？',
    '下午的时间，留给要紧的事',
    '{name}，换个思路，也许就通了',
    '午后好，{name}',
    '{name}，再专注一段时间',
    '下午了，看看今天的清单',
    '{name}，有什么想核对一下的？'
  ],
  evening: [
    '傍晚好，{name}',
    '{name}，今天的事收尾了吗？',
    '天快黑了，今天辛苦了',
    '{name}，下班前还要处理什么？',
    '傍晚了，把今天的进度记一下',
    '{name}，晚饭前再做一点？',
    '一天快结束了，{name}',
    '傍晚好。今天还剩什么？',
    '{name}，把明天要做的先列出来',
    '日落时分，适合回顾今天',
    '{name}，今天有什么收获？',
    '忙了一天，{name}',
    '{name}，收个尾，就可以休息了',
    '傍晚好。慢慢收拾今天的事'
  ],
  night: [
    '晚上好，{name}',
    '{name}，今晚想做点什么？',
    '晚上的时间更自由',
    '{name}，今天过得怎么样？',
    '晚上好。有什么想安静琢磨的？',
    '{name}，白天没做完的，现在看看？',
    '夜里思路更集中',
    '{name}，晚上想研究点什么？',
    '晚上好。想从哪件事开始？',
    '{name}，今天辛苦了',
    '夜晚适合读书和思考',
    '{name}，有什么想趁晚上理清的？',
    '晚上好。不赶时间，慢慢来',
    '{name}，今晚有什么灵感？',
    '忙完一天，再看看手头的事',
    '{name}，睡前还想弄清什么？',
    '休息之前，还有什么要做，{name}？',
    '夜色正好，{name}'
  ]
}

const BY_WEEKDAY: Record<number, string[]> = {
  1: ['周一好，{name}', '{name}，新的一周，从哪里开始？', '周一了，先把这周的事排一排', '{name}，这周最要紧的是什么？'],
  2: ['周二好，{name}', '{name}，这周进展还顺利吗？', '周二了，节奏稳住', '{name}，这周的计划推进到哪了？'],
  3: ['周三好，{name}', '一周过半了，{name}', '{name}，周中看看进度？', '周三了，调整一下节奏'],
  4: ['周四好，{name}', '{name}，这周还剩哪些没做完？', '周四了，开始收拢这周的事', '{name}，离周末不远了'],
  5: ['周五好，{name}', '{name}，周末前收个尾？', '周五了，这周最后一件是什么？', '{name}，这一周辛苦了'],
  6: ['周六好，{name}', '{name}，周末还在忙？', '周末愉快，{name}', '{name}，周末想研究点什么？'],
  0: ['周日好，{name}', '{name}，周日适合想想下周', '周末过得好吗，{name}？', '{name}，为下周做些准备？']
}

const HOLIDAYS: Record<string, string[]> = {
  '01-01': ['新年好，{name}', '{name}，新年第一天，想做点什么？', '新的一年，慢慢来'],
  '02-14': ['情人节快乐，{name}'],
  '03-08': ['节日快乐，{name}'],
  '03-12': ['植树节好，{name}'],
  '04-01': ['{name}，今天说的都是真话'],
  '05-01': ['劳动节快乐，{name}', '{name}，假期还在忙？'],
  '05-04': ['青年节快乐，{name}'],
  '06-01': ['儿童节快乐，{name}'],
  '09-10': ['教师节快乐，{name}'],
  '10-01': ['国庆快乐，{name}', '{name}，假期愉快'],
  '10-24': ['程序员节快乐，{name}', '{name}，1024 快乐'],
  '12-24': ['平安夜快乐，{name}'],
  '12-25': ['圣诞快乐，{name}'],
  '12-31': ['{name}，今年的最后一天了', '跨年夜快乐，{name}', '{name}，回头看看这一年？']
}

const GENERIC = [
  '有什么可以帮你的，{name}？',
  '{name}，今天最想解决的是什么？',
  '在的，{name}',
  '{name}，想聊些什么？',
  '今天想聊些什么？',
  '{name}，有什么新想法？',
  '随时可以开始，{name}',
  '{name}，有什么想理清楚的？',
  '想到哪里，就从哪里说起',
  '{name}，有问题尽管问',
  '今天想做些什么？',
  '{name}，我们一起想想',
  '有什么想弄明白的？',
  '{name}，说说看',
  '从一个问题开始',
  '{name}，手头有什么难题？',
  '欢迎回来，{name}',
  '{name}，今天想学点什么？',
  '先把想法写下来，{name}',
  '{name}，有什么灵感？',
  '把问题说清楚，答案就近了',
  '{name}，需要查些什么？',
  '一步一步来',
  '{name}，有什么需要整理的？',
  '不急，想清楚再开始',
  '{name}，今天要处理什么？',
  '有什么想讨论的？',
  '{name}，从哪个细节说起？',
  '复杂的事，拆开来看',
  '{name}，需要我先看看什么？',
  '准备好了，{name}',
  '{name}，要写点什么？',
  '好的问题，是好的开始',
  '{name}，有什么想验证的？',
  '把思路说出来，一起推敲'
]

const FIRST = [
  '欢迎来到 CC Shell，{name}',
  '{name}，我们从第一段对话开始',
  '你好，{name}。想聊什么都可以',
  '初次见面，{name}',
  '你好，{name}。从任何问题开始都可以',
  '{name}，欢迎。先随便聊聊？'
]

function slotOf(h: number): Slot {
  if (h < 5) return 'lateNight'
  if (h < 8) return 'early'
  if (h < 11) return 'morning'
  if (h < 13) return 'noon'
  if (h < 17) return 'afternoon'
  if (h < 19) return 'evening'
  return 'night'
}

export function fillName(line: string, name?: string): string {
  if (name) return line.replace('{name}', name)
  return line.replace(/^\{name\}，/, '').replace(/，\{name\}([，。？])/, '$1').replace(/，\{name\}$/, '')
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export function greeting(opts: { name?: string; firstTime?: boolean; now?: Date }): string {
  const now = opts.now ?? new Date()
  const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const holiday = HOLIDAYS[key]
  let line: string
  if (opts.firstTime && Math.random() < 0.7) line = pick(FIRST)
  else if (holiday && Math.random() < 0.6) line = pick(holiday)
  else {
    const r = Math.random()
    line = r < 0.6 ? pick(BY_SLOT[slotOf(now.getHours())]) : r < 0.8 ? pick(BY_WEEKDAY[now.getDay()]) : pick(GENERIC)
  }
  return fillName(line, opts.name?.trim() || undefined)
}

export const ALL_GREETINGS = [...Object.values(BY_SLOT).flat(), ...Object.values(BY_WEEKDAY).flat(), ...Object.values(HOLIDAYS).flat(), ...GENERIC, ...FIRST]
