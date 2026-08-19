// db.js —— 数据层：Postgres 优先，本地 JSON 文件自动降级
// 设计要点：
//   1) 生产环境（设置了 DATABASE_URL）优先使用 Postgres，整份状态以 JSONB 存于单行
//   2) 若 Postgres 不可用（网络/配置异常），自动降级到本地 JSON 文件，服务不因此中断
//   3) load()/save() 维持同步语义，server.js 与 matcher.js 的业务逻辑无需改动
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
let cache = null;      // 内存中的单一状态对象
let pool = null;       // pg 连接池（懒加载）
let lastDbError = null; // 最近一次数据库连接错误（便于诊断）

function now() { return new Date().toISOString(); }
function gid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

const defaultData = () => ({
  users: [],          // {id, role, name, phone, createdAt}
  students: [],       // {id, userId, name, major, gpa, skills:[], internship, intention:{industry,city,type}, tags:[], createdAt}
  enterprises: [],    // {id, userId, name, industry, contact, tags:[], createdAt}
  positions: [],      // {id, enterpriseId, title, requirements, salary, skills:[], requiredMajors:[], industry, city, tags:[], status:'open', createdAt}
  recommendations: [],// {id, studentId, positionId, score, level, detail:{}, status, createdAt}
  pushes: [],         // {id, recommendationId, direction:'student'|'enterprise', status:'pending'|'viewed'|'interested'|'rejected', at}
  followups: [],      // {id, recommendationId, interviewTime, interviewPlace, interviewResult, signStatus, offerLetter, updatedAt}
  matchRules: {
    weights: { majorExact: 35, majorRelated: 20, skill: 35, gpa: 15, intIndustry: 8, intCity: 4, internship: 8 },
    thresholds: { high: 78, mid: 56 }
  }
});

// ---- 种子数据：让系统开箱即用 ----
function seed(db) {
  const t = now();
  const stu = [
    { name: '张明', major: '软件工程', gpa: 3.8, skills: ['Java', 'Spring', 'MySQL', '微服务'], internship: '阿里云实习', intention: { industry: '互联网', city: '杭州', type: '研发' } },
    { name: '李雪', major: '软件工程', gpa: 3.5, skills: ['Python', 'Django', '数据分析'], internship: '字节跳动数据分析实习', intention: { industry: '互联网', city: '北京', type: '数据' } },
    { name: '王浩', major: '市场营销', gpa: 3.2, skills: ['新媒体运营', '文案策划', 'Excel'], internship: '京东市场部实习', intention: { industry: '快消', city: '上海', type: '市场' } },
    { name: '陈静', major: '财务管理', gpa: 3.9, skills: ['财务分析', 'Excel', 'CPA备考'], internship: '普华永道审计实习', intention: { industry: '金融', city: '上海', type: '财务' } },
    { name: '刘洋', major: '电子信息', gpa: 3.4, skills: ['C++', '嵌入式', '硬件调试'], internship: '华为硬件实习', intention: { industry: '通信', city: '深圳', type: '硬件' } },
    { name: '赵琳', major: '视觉传达', gpa: 3.6, skills: ['UI设计', 'Figma', 'Photoshop'], internship: '腾讯设计实习', intention: { industry: '互联网', city: '深圳', type: '设计' } }
  ];
  stu.forEach((s) => {
    const id = gid('stu');
    const tags = buildStudentTags(s);
    db.students.push({ id, userId: null, name: s.name, major: s.major, gpa: s.gpa, skills: s.skills, internship: s.internship, intention: s.intention, tags, createdAt: t });
  });

  const ent = [
    { name: '云启科技', industry: '互联网', contact: '王经理 13800000001' },
    { name: '锐进金融', industry: '金融', contact: '李总监 13800000002' },
    { name: '优创快消', industry: '快消', contact: '陈主管 13800000003' }
  ];
  const entIds = {};
  ent.forEach(e => {
    const id = gid('ent');
    entIds[e.name] = id;
    db.enterprises.push({ id, userId: null, name: e.name, industry: e.industry, contact: e.contact, tags: [e.industry], createdAt: t });
  });

  const pos = [
    { enterprise: '云启科技', title: 'Java 后端开发', salary: '15-25k', skills: ['Java', 'Spring', 'MySQL'], requiredMajors: ['软件工程', '计算机科学'], industry: '互联网', city: '杭州', requirements: '熟悉 Spring 生态，有微服务经验优先' },
    { enterprise: '云启科技', title: '数据分析师', salary: '14-22k', skills: ['Python', '数据分析', 'SQL'], requiredMajors: ['软件工程', '统计学', '数学'], industry: '互联网', city: '北京', requirements: '掌握 Python 数据分析，有实习经历优先' },
    { enterprise: '锐进金融', title: '财务分析专员', salary: '12-18k', skills: ['财务分析', 'Excel'], requiredMajors: ['财务管理', '会计'], industry: '金融', city: '上海', requirements: '财务相关专业，有事务所实习优先' },
    { enterprise: '优创快消', title: '新媒体运营', salary: '8-12k', skills: ['新媒体运营', '文案策划'], requiredMajors: ['市场营销', '传播学'], industry: '快消', city: '上海', requirements: '熟悉新媒体玩法，文案能力强' },
    { enterprise: '云启科技', title: 'UI 设计师', salary: '12-20k', skills: ['UI设计', 'Figma', 'Photoshop'], requiredMajors: ['视觉传达', '数字媒体'], industry: '互联网', city: '深圳', requirements: '有设计实习作品集优先' }
  ];
  pos.forEach(p => {
    const id = gid('pos');
    const tags = buildPositionTags(p);
    db.positions.push({ id, enterpriseId: entIds[p.enterprise], title: p.title, requirements: p.requirements, salary: p.salary, skills: p.skills, requiredMajors: p.requiredMajors, industry: p.industry, city: p.city, tags, status: 'open', createdAt: t });
  });
}

// 学生能力画像标签
function buildStudentTags(s) {
  const tags = [s.major];
  (s.skills || []).forEach(k => tags.push(k));
  tags.push(s.gpa >= 3.7 ? '学业优秀' : (s.gpa >= 3.3 ? '学业良好' : '学业一般'));
  if (s.internship) tags.push('有实习经验');
  if (s.intention && s.intention.industry) tags.push('意向-' + s.intention.industry);
  return tags;
}
// 岗位需求画像标签
function buildPositionTags(p) {
  const tags = [];
  (p.requiredMajors || []).forEach(m => tags.push('要求-' + m));
  (p.skills || []).forEach(k => tags.push('要求-' + k));
  if (p.industry) tags.push('行业-' + p.industry);
  if (p.city) tags.push('城市-' + p.city);
  return tags;
}

// ---------- 持久化 ----------
function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const cs = process.env.DATABASE_URL || '';
    // 内部主机名（仅实例 id，如 dpg-xxx）走 Render 私有网络，无需 SSL；
    // 外部主机名需 sslmode=require 才启用 SSL，避免明文被服务端中断。
    const useSsl = /sslmode=(require|prefer)|ssl=true/i.test(cs) || /render\.com/i.test(cs);
    pool = new Pool({
      connectionString: cs,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 5,
      idleTimeoutMillis: 30000
    });
    pool.on('error', (e) => console.error('[db] pool error:', e.message));
  }
  return pool;
}

async function persist() {
  if (!cache) return;
  if (pool) {
    const sql = `INSERT INTO app_state(id, data, updated_at) VALUES(1, $1, now())
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    await pool.query(sql, [JSON.stringify(cache)]);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8');
  }
}

// 初始化：连接数据库并加载数据到内存；失败则降级到本地文件
async function init() {
  if (process.env.DATABASE_URL) {
    try {
      const p = getPool();
      await p.query(`CREATE TABLE IF NOT EXISTS app_state (
        id INT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`);
      const r = await p.query('SELECT data FROM app_state WHERE id = 1');
      if (r.rows.length && r.rows[0].data) {
        cache = r.rows[0].data;
        const keys = Object.keys(cache).length;
        console.log(`[db] ✅ 已从 Postgres 加载数据 (${keys} 类业务对象)`);
      } else {
        cache = defaultData();
        seed(cache);
        await persist();
        console.log('[db] ✅ 已写入种子数据到 Postgres');
      }
      return;
    } catch (e) {
      console.error('[db] ⚠️ Postgres 不可用，降级到本地 JSON 文件:', e.message);
      lastDbError = e.message;
      pool = null;
    }
  }
  // 文件兜底
  try {
    if (fs.existsSync(DATA_FILE)) cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    else { cache = defaultData(); seed(cache); fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2)); }
  } catch (e) {
    console.error('[db] 文件加载失败，使用内存种子:', e.message);
    cache = defaultData(); seed(cache);
  }
}

function load() {
  if (!cache) {
    try {
      if (fs.existsSync(DATA_FILE)) cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      else { cache = defaultData(); seed(cache); }
    } catch (e) { cache = defaultData(); seed(cache); }
  }
  return cache;
}

// save() 维持「改完内存立即返回」的同步语义；落库/落盘在后台完成
function save() {
  if (!cache) return cache;
  if (pool) {
    persist().catch(e => console.error('[db] 持久化失败:', e.message));
  } else {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8'); }
    catch (e) { console.error('[db] 文件写入失败:', e.message); }
  }
  return cache;
}

// 对外暴露
module.exports = {
  init, load, save, gid, now,
  buildStudentTags, buildPositionTags,
  // 简单查询助手
  all: (key) => load()[key],
  get: (key, id) => load()[key].find(x => x.id === id),
  insert: (key, obj) => { const db = load(); db[key].push(obj); save(); return obj; },
  update: (key, id, patch) => {
    const db = load();
    const item = db[key].find(x => x.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    save();
    return item;
  },
  remove: (key, id) => {
    const db = load();
    const i = db[key].findIndex(x => x.id === id);
    if (i >= 0) { db[key].splice(i, 1); save(); return true; }
    return false;
  },
  reset: () => { cache = defaultData(); seed(cache); save(); return cache; },
  usingDatabase: () => !!pool,
  dbStatus: () => ({ usingDatabase: !!pool, databaseUrlSet: !!process.env.DATABASE_URL, lastError: lastDbError })
};
