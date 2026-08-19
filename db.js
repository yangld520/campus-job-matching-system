// db.js —— 零依赖 JSON 文件数据层
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

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

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(DATA_FILE)) {
      cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } else {
      cache = defaultData();
      seed(cache);
      save();
    }
  } catch (e) {
    cache = defaultData();
    seed(cache);
    save();
  }
  return cache;
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// ---- 种子数据：让系统开箱即用 ----
function seed(db) {
  const t = now();
  // 学生
  const stu = [
    { name: '张明', major: '软件工程', gpa: 3.8, skills: ['Java', 'Spring', 'MySQL', '微服务'], internship: '阿里云实习', intention: { industry: '互联网', city: '杭州', type: '研发' } },
    { name: '李雪', major: '软件工程', gpa: 3.5, skills: ['Python', 'Django', '数据分析'], internship: '字节跳动数据分析实习', intention: { industry: '互联网', city: '北京', type: '数据' } },
    { name: '王浩', major: '市场营销', gpa: 3.2, skills: ['新媒体运营', '文案策划', 'Excel'], internship: '京东市场部实习', intention: { industry: '快消', city: '上海', type: '市场' } },
    { name: '陈静', major: '财务管理', gpa: 3.9, skills: ['财务分析', 'Excel', 'CPA备考'], internship: '普华永道审计实习', intention: { industry: '金融', city: '上海', type: '财务' } },
    { name: '刘洋', major: '电子信息', gpa: 3.4, skills: ['C++', '嵌入式', '硬件调试'], internship: '华为硬件实习', intention: { industry: '通信', city: '深圳', type: '硬件' } },
    { name: '赵琳', major: '视觉传达', gpa: 3.6, skills: ['UI设计', 'Figma', 'Photoshop'], internship: '腾讯设计实习', intention: { industry: '互联网', city: '深圳', type: '设计' } }
  ];
  stu.forEach((s, i) => {
    const id = gid('stu');
    const tags = buildStudentTags(s);
    db.students.push({ id, userId: null, name: s.name, major: s.major, gpa: s.gpa, skills: s.skills, internship: s.internship, intention: s.intention, tags, createdAt: t });
  });

  // 企业
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

  // 岗位
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

// 对外暴露
module.exports = {
  load, save, gid, now,
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
  reset: () => { cache = defaultData(); seed(cache); save(); return cache; }
};
