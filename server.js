// server.js —— 零依赖 HTTP 服务 + REST API + 静态资源
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const matcher = require('./matcher');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ---------- 工具 ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { resolve({}); }
    });
  });
}
const CT = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let fp = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!fp.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': CT['.html'] }); res.end(b2);
      });
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': CT[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- 业务助手 ----------
function enrichRecommendation(rec) {
  const data = db.load();
  const student = data.students.find(s => s.id === rec.studentId);
  const position = data.positions.find(p => p.id === rec.positionId);
  const enterprise = position ? data.enterprises.find(e => e.id === position.enterpriseId) : null;
  const pushes = data.pushes.filter(p => p.recommendationId === rec.id);
  const followup = data.followups.find(f => f.recommendationId === rec.id);
  return {
    ...rec,
    student: student ? { id: student.id, name: student.name, major: student.major, gpa: student.gpa, tags: student.tags } : null,
    position: position ? { id: position.id, title: position.title, salary: position.salary, city: position.city, industry: position.industry, skills: position.skills } : null,
    enterprise: enterprise ? { id: enterprise.id, name: enterprise.name } : null,
    pushes, followup: followup || null
  };
}

function recomputeRecStatus(rec) {
  const data = db.load();
  const pushes = data.pushes.filter(p => p.recommendationId === rec.id);
  const s = pushes.find(p => p.direction === 'student');
  const e = pushes.find(p => p.direction === 'enterprise');
  if ((s && s.status === 'rejected') || (e && e.status === 'rejected')) rec.status = 'rejected';
  else if (s && e && s.status === 'interested' && e.status === 'interested') rec.status = 'matched';
  else if (s && s.status === 'interested') rec.status = 'student_interested';
  else if (e && e.status === 'interested') rec.status = 'enterprise_interested';
  else rec.status = 'pending';
  db.save();
}

function buildDashboard() {
  const data = db.load();
  const students = data.students;
  const positions = data.positions.filter(p => p.status === 'open');
  const recs = data.recommendations;
  const followups = data.followups;

  const signed = followups.filter(f => f.signStatus === 'signed').length;
  const interviewed = followups.filter(f => f.interviewResult).length;
  const matchedBoth = recs.filter(r => r.status === 'matched').length;
  const recommendedStudents = new Set(recs.map(r => r.studentId)).size;

  // 各专业转化
  const byMajor = {};
  students.forEach(s => {
    byMajor[s.major] = byMajor[s.major] || { total: 0, recommended: 0, signed: 0 };
    byMajor[s.major].total++;
  });
  recs.forEach(r => {
    const st = students.find(s => s.id === r.studentId);
    if (st && byMajor[st.major]) byMajor[st.major].recommended++;
  });
  followups.forEach(f => {
    const r = recs.find(x => x.id === f.recommendationId);
    if (r && f.signStatus === 'signed') {
      const st = students.find(s => s.id === r.studentId);
      if (st && byMajor[st.major]) byMajor[st.major].signed++;
    }
  });

  // 企业合作质量排行（按收到感兴趣推荐数）
  const entRank = data.enterprises.map(ent => {
    const entPos = data.positions.filter(p => p.enterpriseId === ent.id).map(p => p.id);
    const entRecs = recs.filter(r => entPos.includes(r.positionId));
    const interested = entRecs.filter(r => r.status === 'matched' || r.status === 'enterprise_interested').length;
    const signedEnt = followups.filter(f => f.signStatus === 'signed' && entRecs.find(r => r.id === f.recommendationId)).length;
    return { id: ent.id, name: ent.name, recommendations: entRecs.length, interested, signed: signedEnt };
  }).sort((a, b) => b.interested - a.interested);

  // 风险标记：双方感兴趣但无跟进 / 学生长期无推荐 / 高拒绝率
  const risk = [];
  recs.filter(r => r.status === 'matched').forEach(r => {
    const f = followups.find(x => x.recommendationId === r.id);
    if (!f || !f.interviewTime) {
      const st = students.find(s => s.id === r.studentId);
      risk.push({ type: '待安排面试', student: st ? st.name : '?', detail: '双方已感兴趣，但尚未记录面试安排', recId: r.id });
    }
  });
  students.filter(s => !recs.find(r => r.studentId === s.id)).forEach(s => {
    risk.push({ type: '未匹配岗位', student: s.name, detail: '暂无任何推荐记录，建议补充画像或岗位', recId: null });
  });

  const funnel = {
    students: students.length,
    recommended: recommendedStudents,
    matched: matchedBoth,
    interviewed,
    signed
  };

  return {
    metrics: {
      openPositions: positions.length,
      totalStudents: students.length,
      recommendedStudents,
      totalRecommendations: recs.length,
      matchedBoth,
      interviewed,
      signed,
      interviewRate: interviewed ? +(interviewed / Math.max(1, matchedBoth) * 100).toFixed(1) : 0,
      signRate: signed ? +(signed / Math.max(1, recs.length) * 100).toFixed(1) : 0
    },
    funnel,
    byMajor: Object.entries(byMajor).map(([major, v]) => ({ major, ...v })),
    entRank,
    risk,
    storage: db.usingDatabase() ? 'postgres' : 'file'
  };
}

// ---------- 路由 ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}

// 登录 / 角色
route('POST', '/api/login', async (req, res, params, body) => {
  const data = db.load();
  const role = body.role;
  const name = (body.name || '').trim() || '匿名用户';
  let user = data.users.find(u => u.role === role && u.name === name);
  if (!user) {
    user = { id: db.gid('usr'), role, name, phone: body.phone || '', createdAt: db.now() };
    data.users.push(user);
  }
  let studentId = null, enterpriseId = null;
  if (role === 'student') {
    let st = data.students.find(s => s.name === name);
    if (!st) { st = { id: db.gid('stu'), userId: user.id, name, major: '', gpa: 0, skills: [], internship: '', intention: {}, tags: ['待完善'], createdAt: db.now() }; data.students.push(st); }
    studentId = st.id; user.studentId = st.id;
  } else if (role === 'enterprise') {
    let ent = data.enterprises.find(e => e.name === name);
    if (!ent) { ent = { id: db.gid('ent'), userId: user.id, name, industry: '', contact: '', tags: [], createdAt: db.now() }; data.enterprises.push(ent); }
    enterpriseId = ent.id; user.enterpriseId = ent.id;
  }
  db.save();
  sendJSON(res, 200, { user: { id: user.id, role: user.role, name: user.name, studentId, enterpriseId } });
});

// 学生
route('GET', '/api/students', async (req, res) => sendJSON(res, 200, db.all('students')));
route('POST', '/api/students', async (req, res, params, body) => {
  const s = {
    id: db.gid('stu'), userId: null, name: body.name, major: body.major || '', gpa: +body.gpa || 0,
    skills: body.skills || [], internship: body.internship || '', intention: body.intention || {},
    tags: db.buildStudentTags({ major: body.major, skills: body.skills, gpa: +body.gpa || 0, internship: body.internship, intention: body.intention }),
    createdAt: db.now()
  };
  db.insert('students', s);
  sendJSON(res, 200, s);
});

// 企业
route('GET', '/api/enterprises', async (req, res) => sendJSON(res, 200, db.all('enterprises')));
route('POST', '/api/enterprises', async (req, res, params, body) => {
  const e = { id: db.gid('ent'), userId: null, name: body.name, industry: body.industry || '', contact: body.contact || '', tags: [body.industry].filter(Boolean), createdAt: db.now() };
  db.insert('enterprises', e);
  sendJSON(res, 200, e);
});

// 岗位
route('GET', '/api/positions', async (req, res) => {
  const data = db.load();
  const list = data.positions.map(p => ({ ...p, enterprise: data.enterprises.find(e => e.id === p.enterpriseId) }));
  sendJSON(res, 200, list);
});
route('POST', '/api/positions', async (req, res, params, body) => {
  const p = {
    id: db.gid('pos'), enterpriseId: body.enterpriseId, title: body.title, requirements: body.requirements || '',
    salary: body.salary || '', skills: body.skills || [], requiredMajors: body.requiredMajors || [],
    industry: body.industry || '', city: body.city || '', tags: db.buildPositionTags({ requiredMajors: body.requiredMajors, skills: body.skills, industry: body.industry, city: body.city }),
    status: 'open', createdAt: db.now()
  };
  db.insert('positions', p);
  sendJSON(res, 200, p);
});

// 匹配
route('POST', '/api/match', async (req, res) => {
  const result = matcher.runMatching();
  sendJSON(res, 200, result);
});

// 推荐
route('GET', '/api/recommendations', async (req, res, params, body, query) => {
  const data = db.load();
  let recs = data.recommendations;
  const role = query.get('role');
  const studentId = query.get('studentId');
  const enterpriseId = query.get('enterpriseId');
  let list = recs;
  if (role === 'student' && studentId) list = recs.filter(r => r.studentId === studentId);
  else if (role === 'enterprise' && enterpriseId) {
    const entPos = data.positions.filter(p => p.enterpriseId === enterpriseId).map(p => p.id);
    list = recs.filter(r => entPos.includes(r.positionId));
  }
  sendJSON(res, 200, list.map(enrichRecommendation));
});

// 反馈（双向触达闭环）
route('POST', '/api/recommendations/:id/feedback', async (req, res, params, body) => {
  const data = db.load();
  const rec = data.recommendations.find(r => r.id === params.id);
  if (!rec) return sendJSON(res, 404, { error: 'not found' });
  const push = data.pushes.find(p => p.recommendationId === rec.id && p.direction === body.direction);
  if (push) { push.status = body.status; push.at = db.now(); }
  recomputeRecStatus(rec);
  sendJSON(res, 200, enrichRecommendation(rec));
});

// 跟进（面试 / 签约）
route('POST', '/api/recommendations/:id/followup', async (req, res, params, body) => {
  const data = db.load();
  const rec = data.recommendations.find(r => r.id === params.id);
  if (!rec) return sendJSON(res, 404, { error: 'not found' });
  let f = data.followups.find(x => x.recommendationId === rec.id);
  const patch = {
    interviewTime: body.interviewTime || (f && f.interviewTime),
    interviewPlace: body.interviewPlace || (f && f.interviewPlace),
    interviewResult: body.interviewResult || (f && f.interviewResult),
    signStatus: body.signStatus || (f && f.signStatus),
    offerLetter: body.offerLetter || (f && f.offerLetter),
    updatedAt: db.now()
  };
  if (f) Object.assign(f, patch);
  else { f = { id: db.gid('fu'), recommendationId: rec.id, ...patch }; data.followups.push(f); }
  // 同步推荐状态
  if (patch.signStatus === 'signed') rec.status = 'signed';
  else if (patch.interviewResult === '通过') rec.status = 'interview_passed';
  else if (patch.interviewResult === '未通过') rec.status = 'interview_failed';
  else if (patch.interviewTime) rec.status = 'interviewing';
  db.save();
  sendJSON(res, 200, enrichRecommendation(rec));
});

// 看板
route('GET', '/api/dashboard', async (req, res) => sendJSON(res, 200, buildDashboard()));

// 重置（演示用）
route('POST', '/api/reset', async (req, res) => { db.reset(); sendJSON(res, 200, { ok: true }); });

// ---------- 请求分发 ----------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  if (pathname.startsWith('/api/')) {
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.regex);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        try { await r.handler(req, res, params, body, parsed.searchParams); } catch (e) { sendJSON(res, 500, { error: e.message }); }
        return;
      }
    }
    sendJSON(res, 404, { error: 'route not found' });
    return;
  }
  serveStatic(req, res, pathname);
});

db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`✅ 校园就业系统已启动: http://localhost:${PORT}`);
    console.log(process.env.DATABASE_URL ? '🗄️  已启用 Postgres 数据库持久化' : '📄 使用本地 JSON 文件存储');
  });
}).catch(err => {
  console.error('❌ 初始化失败:', err);
  process.exit(1);
});
