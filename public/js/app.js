// app.js —— 校园就业系统前端 SPA
const API = (p, m = 'GET', b) => fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

let state = { user: null, view: null, charts: [] };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const NAV = {
  student: [
    { id: 'recs', ic: '📨', label: '推荐', view: 'studentRecs' },
    { id: 'progress', ic: '📈', label: '进度', view: 'studentProgress' },
    { id: 'profile', ic: '🙋', label: '画像', view: 'studentProfile' }
  ],
  enterprise: [
    { id: 'students', ic: '🎓', label: '人才', view: 'entStudents' },
    { id: 'positions', ic: '💼', label: '岗位', view: 'entPositions' },
    { id: 'post', ic: '➕', label: '发布', view: 'entPost' }
  ],
  teacher: [
    { id: 'match', ic: '🤖', label: '匹配', view: 'teacherMatch' },
    { id: 'manage', ic: '🗂️', label: '管理', view: 'teacherManage' },
    { id: 'follow', ic: '🤝', label: '跟进', view: 'teacherFollow' },
    { id: 'dash', ic: '📊', label: '看板', view: 'dashboard' }
  ],
  admin: [ { id: 'dash', ic: '📊', label: '看板', view: 'dashboard' }, { id: 'risk', ic: '⚠️', label: '风险', view: 'risk' } ]
};

const ROLE_NAME = { student: '学生', enterprise: '企业/HR', teacher: '辅导员', admin: '管理者' };

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- 登录 ----------
let selectedRole = null;
function bindLogin() {
  $$('.role-btn').forEach(b => b.onclick = () => {
    $$('.role-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); selectedRole = b.dataset.role;
  });
  $('#loginBtn').onclick = async () => {
    const name = $('#nameInput').value.trim();
    if (!selectedRole) return toast('请先选择身份');
    if (!name) return toast('请输入姓名');
    const res = await API('/api/login', 'POST', { role: selectedRole, name });
    state.user = res.user;
    enterApp();
  };
}

function enterApp() {
  $('#login').classList.add('hidden');
  $('#main').classList.remove('hidden');
  $('#roleTag').textContent = ROLE_NAME[state.user.role];
  $('#userName').textContent = state.user.name;
  const nav = NAV[state.user.role];
  state.view = nav[0].view;
  renderNav();
  renderView();
}

function renderNav() {
  const nav = NAV[state.user.role];
  $('#nav').innerHTML = nav.map(n => `<button data-nav="${n.view}" class="${state.view === n.view ? 'active' : ''}"><span class="ic">${n.ic}</span>${n.label}</button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => { state.view = b.dataset.nav; renderNav(); renderView(); });
}

// ---------- 视图分发 ----------
async function renderView() {
  destroyCharts();
  const v = state.view;
  const map = {
    studentRecs, studentProgress, studentProfile,
    entStudents, entPositions, entPost,
    teacherMatch, teacherManage, teacherFollow,
    dashboard, risk
  };
  if (map[v]) await map[v]();
}

// ---------- 学生：推荐 ----------
async function studentRecs() {
  const list = await API(`/api/recommendations?role=student&studentId=${state.user.studentId}`);
  const pushStatus = (r, d) => { const p = (r.pushes || []).find(x => x.direction === d); return p ? p.status : 'pending'; };
  let html = `<div class="section-title">为你推荐的岗位 <span class="muted">${list.length} 条</span></div>`;
  if (!list.length) html += `<div class="empty">暂无匹配岗位，已通知辅导员补充岗位～</div>`;
  list.forEach(r => {
    const st = pushStatus(r, 'student');
    const cls = r.level === '高匹配' ? 'high' : (r.level === '中匹配' ? 'mid' : 'low');
    html += `<div class="card rec ${cls}">
      <div class="head"><span class="title">${r.position.title}</span><span class="score ${cls}">${r.score}</span></div>
      <div class="row" style="margin:4px 0"><span class="level-pill ${cls}">${r.level}</span><span class="muted">${r.enterprise.name} · ${r.position.city} · ${r.position.salary}</span></div>
      <div class="kv">🎯 推荐理由：${(r.detail.overlap || 0) > 0 ? '技能重叠 ' + r.detail.overlap + ' 项' : ''} ${r.detail.majorScore >= 35 ? '· 专业对口' : ''} ${r.detail.intScore > 0 ? '· 意向契合' : ''}</div>
      <div style="margin-top:8px">${st === 'interested' ? '<span class="status-pill matched">已感兴趣 ✓</span>' : st === 'rejected' ? '<span class="status-pill rejected">暂不感兴趣</span>' : `<div class="row"><button class="btn-sm btn-green" data-act="s-fb" data-id="${r.id}" data-st="interested">感兴趣</button><button class="btn-sm btn-line" data-act="s-fb" data-id="${r.id}" data-st="rejected">不感兴趣</button></div>`}</div>
    </div>`;
  });
  $('#view').innerHTML = html;
  $$('[data-act="s-fb"]').forEach(b => b.onclick = async () => {
    await API(`/api/recommendations/${b.dataset.id}/feedback`, 'POST', { direction: 'student', status: b.dataset.st });
    toast('已记录你的反馈'); renderView();
  });
}

async function studentProgress() {
  const list = await API(`/api/recommendations?role=student&studentId=${state.user.studentId}`);
  const order = { matched: 0, student_interested: 1, enterprise_interested: 2, interviewing: 3, interview_passed: 4, signed: 5, rejected: 6, pending: 7 };
  const labels = { matched: '双方感兴趣', student_interested: '你已感兴趣', enterprise_interested: '企业已关注', interviewing: '面试中', interview_passed: '面试通过', signed: '已签约 🎉', rejected: '已结束', pending: '待反馈' };
  list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  let html = `<div class="section-title">我的求职进度</div>`;
  if (!list.length) html += `<div class="empty">还没有推荐记录</div>`;
  list.forEach(r => {
    html += `<div class="card"><div class="head"><span class="title">${r.position.title}</span><span class="status-pill ${r.status}">${labels[r.status] || r.status}</span></div><div class="kv">${r.enterprise.name} · 匹配度 ${r.score}</div></div>`;
  });
  $('#view').innerHTML = html;
}

async function studentProfile() {
  const all = await API('/api/students');
  const me = all.find(s => s.id === state.user.studentId) || {};
  const html = `<div class="section-title">我的能力画像</div>
    <div class="card">
      <h3>${me.name || state.user.name}</h3>
      <div class="kv">专业：${me.major || '—'} ｜ GPA：${me.gpa || '—'}</div>
      <div class="kv">实习：${me.internship || '暂无'}</div>
      <div style="margin-top:8px">${(me.tags || []).map(t => `<span class="tag brand">${t}</span>`).join('')}</div>
    </div>
    <div class="card"><div class="muted">系统基于你的专业、成绩、技能与实习自动生成画像标签，用于智能匹配。如需更新资料，请联系辅导员。</div></div>`;
  $('#view').innerHTML = html;
}

// ---------- 企业 ----------
async function entStudents() {
  const list = await API(`/api/recommendations?role=enterprise&enterpriseId=${state.user.enterpriseId}`);
  const pushStatus = (r, d) => { const p = (r.pushes || []).find(x => x.direction === d); return p ? p.status : 'pending'; };
  let html = `<div class="section-title">系统推荐的人才 <span class="muted">${list.length} 人</span></div>`;
  if (!list.length) html += `<div class="empty">暂无匹配学生，可尝试发布更多岗位</div>`;
  list.forEach(r => {
    const st = pushStatus(r, 'enterprise');
    const cls = r.level === '高匹配' ? 'high' : (r.level === '中匹配' ? 'mid' : 'low');
    html += `<div class="card rec ${cls}">
      <div class="head"><span class="title">${r.student.name}</span><span class="score ${cls}">${r.score}</span></div>
      <div class="row" style="margin:4px 0"><span class="level-pill ${cls}">${r.level}</span><span class="muted">${r.student.major} · GPA ${r.student.gpa}</span></div>
      <div>${(r.student.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
      <div style="margin-top:8px">${st === 'interested' ? '<span class="status-pill matched">已感兴趣 ✓</span>' : st === 'rejected' ? '<span class="status-pill rejected">暂不感兴趣</span>' : `<div class="row"><button class="btn-sm btn-green" data-act="e-fb" data-id="${r.id}" data-st="interested">邀请面试</button><button class="btn-sm btn-line" data-act="e-fb" data-id="${r.id}" data-st="rejected">不合适</button></div>`}</div>
    </div>`;
  });
  $('#view').innerHTML = html;
  $$('[data-act="e-fb"]').forEach(b => b.onclick = async () => {
    await API(`/api/recommendations/${b.dataset.id}/feedback`, 'POST', { direction: 'enterprise', status: b.dataset.st });
    toast('已记录反馈'); renderView();
  });
}

async function entPositions() {
  const list = await API('/api/positions');
  const mine = list.filter(p => p.enterpriseId === state.user.enterpriseId);
  let html = `<div class="section-title">我的岗位 <span class="muted">${mine.length} 个</span></div>`;
  if (!mine.length) html += `<div class="empty">还未发布岗位，点下方「发布」试试</div>`;
  mine.forEach(p => {
    html += `<div class="card"><div class="head"><span class="title">${p.title}</span><span class="muted">${p.status === 'open' ? '招聘中' : '已关闭'}</span></div><div class="kv">${p.city} · ${p.salary}</div><div class="kv">要求：${(p.skills || []).join('、') || '—'}</div></div>`;
  });
  $('#view').innerHTML = html;
}

async function entPost() {
  const ents = await API('/api/enterprises');
  const me = ents.find(e => e.id === state.user.enterpriseId);
  $('#view').innerHTML = `<div class="section-title">发布招聘岗位</div>
    <div class="card">
      <div class="form-grid">
        <div><label class="fld">岗位名称</label><input id="f-title" placeholder="如：Java 后端开发"></div>
        <div class="form-grid two">
          <div><label class="fld">城市</label><input id="f-city" placeholder="如：杭州"></div>
          <div><label class="fld">薪资</label><input id="f-salary" placeholder="如：15-25k"></div>
        </div>
        <div class="form-grid two">
          <div><label class="fld">所属行业</label><input id="f-industry" value="${me ? me.industry : ''}" placeholder="如：互联网"></div>
          <div><label class="fld">要求专业(逗号分隔)</label><input id="f-majors" placeholder="软件工程,计算机科学"></div>
        </div>
        <div><label class="fld">技能要求(逗号分隔)</label><input id="f-skills" placeholder="Java,Spring,MySQL"></div>
        <div><label class="fld">岗位描述</label><textarea id="f-req" rows="2" placeholder="岗位职责与任职要求"></textarea></div>
        <button class="primary" id="doPost">发布并自动匹配</button>
      </div>
    </div>`;
  $('#doPost').onclick = async () => {
    const body = {
      enterpriseId: state.user.enterpriseId,
      title: $('#f-title').value.trim(),
      city: $('#f-city').value.trim(),
      salary: $('#f-salary').value.trim(),
      industry: $('#f-industry').value.trim(),
      requiredMajors: $('#f-majors').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      skills: $('#f-skills').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      requirements: $('#f-req').value.trim()
    };
    if (!body.title) return toast('请填写岗位名称');
    await API('/api/positions', 'POST', body);
    const m = await API('/api/match', 'POST');
    toast(`发布成功，已新增 ${m.created} 条推荐`);
    state.view = 'students'; renderNav(); renderView();
  };
}

// ---------- 辅导员 ----------
async function teacherMatch() {
  const list = await API('/api/recommendations');
  let html = `<div class="section-title">智能匹配引擎</div>
    <div class="card">
      <p class="muted">系统自动计算每位学生与每个开放岗位的匹配度，达标（高/中匹配）即生成推荐并双向推送。</p>
      <button class="primary" id="runMatch">▶ 运行智能匹配</button>
    </div>
    <div class="section-title">全部推荐记录 <span class="muted">${list.length} 条</span></div>`;
  html += recListHtml(list, 'teacher');
  $('#view').innerHTML = html;
  $('#runMatch').onclick = async () => {
    const m = await API('/api/match', 'POST');
    toast(`匹配完成：新增 ${m.created} 条，更新 ${m.updated} 条`);
    renderView();
  };
  bindRecActions();
}

function recListHtml(list, mode) {
  const order = { matched: 0, student_interested: 1, enterprise_interested: 2, interviewing: 3, interview_passed: 4, signed: 5, pending: 6, rejected: 7 };
  const labels = { matched: '双方感兴趣', student_interested: '学生已感兴趣', enterprise_interested: '企业已关注', interviewing: '面试中', interview_passed: '面试通过', signed: '已签约', rejected: '已结束', pending: '待反馈' };
  const arr = [...list].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.score - a.score);
  if (!arr.length) return `<div class="empty">暂无推荐，请先运行匹配或补充数据</div>`;
  return arr.map(r => {
    const cls = r.level === '高匹配' ? 'high' : (r.level === '中匹配' ? 'mid' : 'low');
    return `<div class="card rec ${cls}">
      <div class="head"><span class="title">${r.student ? r.student.name : '?'} → ${r.position ? r.position.title : '?'}</span><span class="score ${cls}">${r.score}</span></div>
      <div class="row" style="margin:4px 0"><span class="level-pill ${cls}">${r.level}</span><span class="status-pill ${r.status}">${labels[r.status] || r.status}</span><span class="muted">${r.enterprise ? r.enterprise.name : ''}</span></div>
      ${mode === 'teacher' && (r.status === 'matched' || r.status === 'student_interested' || r.status === 'enterprise_interested' || r.status === 'interviewing') ? `<div class="row" style="margin-top:6px"><button class="btn-sm btn-brand" data-act="follow" data-id="${r.id}">更新跟进</button></div>` : ''}
    </div>`;
  }).join('');
}

function bindRecActions() {
  $$('[data-act="follow"]').forEach(b => b.onclick = () => openFollowModal(b.dataset.id));
}

async function teacherManage() {
  $('#view').innerHTML = `<div class="section-title">数据管理</div>
    <div class="row" style="margin-bottom:14px">
      <button class="btn-sm btn-brand" data-tab="stu">学生</button>
      <button class="btn-sm btn-line" data-tab="ent">企业</button>
      <button class="btn-sm btn-line" data-tab="pos">岗位</button>
    </div>
    <div id="manageBody"></div>`;
  $$('[data-tab]').forEach(b => b.onclick = () => { $$('[data-tab]').forEach(x => x.className = 'btn-sm btn-line'); b.className = 'btn-sm btn-brand'; loadManage(b.dataset.tab); });
  loadManage('stu');
}

async function loadManage(tab) {
  const body = $('#manageBody');
  if (tab === 'stu') {
    const list = await API('/api/students');
    body.innerHTML = `<button class="primary" style="margin-bottom:12px" id="addStu">+ 录入学生</button>` +
      list.map(s => `<div class="card"><div class="head"><span class="title">${s.name}</span><span class="muted">${s.major}</span></div><div class="kv">GPA ${s.gpa} ｜ ${(s.tags || []).slice(0, 4).map(t => `<span class="tag">${t}</span>`).join('')}</div></div>`).join('');
    $('#addStu').onclick = () => openStudentModal();
  } else if (tab === 'ent') {
    const list = await API('/api/enterprises');
    body.innerHTML = `<button class="primary" style="margin-bottom:12px" id="addEnt">+ 录入企业</button>` +
      list.map(e => `<div class="card"><div class="head"><span class="title">${e.name}</span><span class="muted">${e.industry}</span></div><div class="kv">${e.contact || ''}</div></div>`).join('');
    $('#addEnt').onclick = () => openEnterpriseModal();
  } else {
    const list = await API('/api/positions');
    body.innerHTML = `<button class="primary" style="margin-bottom:12px" id="addPos">+ 发布岗位</button>` +
      list.map(p => `<div class="card"><div class="head"><span class="title">${p.title}</span><span class="muted">${p.status === 'open' ? '招聘中' : '关闭'}</span></div><div class="kv">${p.enterprise ? p.enterprise.name : ''} ｜ ${p.city} ｜ ${(p.skills || []).join('、')}</div></div>`).join('');
    $('#addPos').onclick = () => openPositionModal();
  }
}

async function teacherFollow() {
  const list = await API('/api/recommendations');
  const todo = list.filter(r => ['matched', 'student_interested', 'enterprise_interested', 'interviewing', 'interview_passed'].includes(r.status));
  let html = `<div class="section-title">就业跟进管理 <span class="muted">${todo.length} 条待处理</span></div>`;
  if (!todo.length) html += `<div class="empty">暂无需要跟进的推荐</div>`;
  html += recListHtml(todo, 'teacher');
  $('#view').innerHTML = html;
  bindRecActions();
}

// ---------- 看板 ----------
async function dashboard() {
  const d = await API('/api/dashboard');
  const m = d.metrics;
  $('#view').innerHTML = `<div class="section-title">就业攻坚数据看板</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="num">${m.openPositions}</div><div class="lbl">在招岗位</div></div>
      <div class="kpi c2"><div class="num">${m.totalStudents}</div><div class="lbl">在校学生</div></div>
      <div class="kpi c3"><div class="num">${m.totalRecommendations}</div><div class="lbl">推荐总数</div></div>
      <div class="kpi c4"><div class="num">${m.signed}</div><div class="lbl">已签约</div></div>
      <div class="kpi"><div class="num">${m.matchedBoth}</div><div class="lbl">双方感兴趣</div></div>
      <div class="kpi c2"><div class="num">${m.signRate}%</div><div class="lbl">签约成功率</div></div>
    </div>
    <div class="chart-box"><div class="muted" style="margin-bottom:8px;font-weight:700">转化漏斗（学生→推荐→互感兴趣→面试→签约）</div><canvas id="funnel"></canvas></div>
    <div class="chart-box"><div class="muted" style="margin-bottom:8px;font-weight:700">各专业推荐覆盖</div><canvas id="byMajor"></canvas></div>
    <div class="chart-box"><div class="muted" style="margin-bottom:8px;font-weight:700">企业合作质量排行（收到感兴趣推荐）</div><canvas id="entRank"></canvas></div>`;
  drawFunnel(d.funnel);
  drawByMajor(d.byMajor);
  drawEntRank(d.entRank);
}

function destroyCharts() { state.charts.forEach(c => c.destroy && c.destroy()); state.charts = []; }
function drawFunnel(d) {
  const c = new Chart($('#funnel'), { type: 'bar', data: { labels: ['学生', '被推荐', '互感兴趣', '面试', '签约'], datasets: [{ label: '人数', data: [d.students, d.recommended, d.matched, d.interviewed, d.signed], backgroundColor: '#2f5fff' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  state.charts.push(c);
}
function drawByMajor(d) {
  const c = new Chart($('#byMajor'), { type: 'bar', data: { labels: d.map(x => x.major), datasets: [{ label: '推荐数', data: d.map(x => x.recommended), backgroundColor: '#00b8a9' }, { label: '签约数', data: d.map(x => x.signed), backgroundColor: '#7c5cff' }] }, options: { plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } } });
  state.charts.push(c);
}
function drawEntRank(d) {
  const c = new Chart($('#entRank'), { type: 'bar', data: { labels: d.map(x => x.name), datasets: [{ label: '感兴趣推荐', data: d.map(x => x.interested), backgroundColor: '#f59e0b' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } } });
  state.charts.push(c);
}

async function risk() {
  const d = await API('/api/dashboard');
  let html = `<div class="section-title">风险预警</div>`;
  if (!d.risk.length) html += `<div class="card"><div class="muted">🎉 当前无风险项，就业推进良好。</div></div>`;
  d.risk.forEach(r => {
    html += `<div class="card risk-item"><div class="head"><span class="title">${r.type}</span></div><div class="kv">学生：${r.student}</div><div class="kv">${r.detail}</div></div>`;
  });
  $('#view').innerHTML = html;
}

// ---------- 弹窗表单 ----------
function modal(html) {
  const mask = document.createElement('div'); mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">${html}<button class="btn-sm btn-line" id="closeModal" style="margin-top:14px;width:100%">取消</button></div>`;
  document.body.appendChild(mask);
  mask.onclick = (e) => { if (e.target === mask || e.target.id === 'closeModal') mask.remove(); };
  return mask;
}

function openStudentModal() {
  const m = modal(`<h3>录入学生</h3><div class="form-grid">
    <div><label class="fld">姓名</label><input id="s-name"></div>
    <div class="form-grid two"><div><label class="fld">专业</label><input id="s-major" placeholder="软件工程"></div><div><label class="fld">GPA</label><input id="s-gpa" placeholder="3.8"></div></div>
    <div><label class="fld">技能(逗号分隔)</label><input id="s-skills" placeholder="Java,Spring"></div>
    <div><label class="fld">实习经历</label><input id="s-intern" placeholder="阿里云实习"></div>
    <div class="form-grid two"><div><label class="fld">意向行业</label><input id="s-ind" placeholder="互联网"></div><div><label class="fld">意向城市</label><input id="s-city" placeholder="杭州"></div></div>
    <button class="primary" id="saveStu">保存</button></div>`);
  $('#saveStu', m).onclick = async () => {
    const body = {
      name: $('#s-name', m).value.trim(), major: $('#s-major', m).value.trim(), gpa: $('#s-gpa', m).value.trim(),
      skills: $('#s-skills', m).value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      internship: $('#s-intern', m).value.trim(),
      intention: { industry: $('#s-ind', m).value.trim(), city: $('#s-city', m).value.trim() }
    };
    if (!body.name) return toast('请填写姓名');
    await API('/api/students', 'POST', body);
    toast('学生已录入'); m.remove(); loadManage('stu');
  };
}

function openEnterpriseModal() {
  const m = modal(`<h3>录入企业</h3><div class="form-grid">
    <div><label class="fld">企业名称</label><input id="e-name"></div>
    <div class="form-grid two"><div><label class="fld">行业</label><input id="e-ind" placeholder="互联网"></div><div><label class="fld">联系方式</label><input id="e-contact" placeholder="王经理 138..."></div></div>
    <button class="primary" id="saveEnt">保存</button></div>`);
  $('#saveEnt', m).onclick = async () => {
    const body = { name: $('#e-name', m).value.trim(), industry: $('#e-ind', m).value.trim(), contact: $('#e-contact', m).value.trim() };
    if (!body.name) return toast('请填写企业名称');
    await API('/api/enterprises', 'POST', body); toast('企业已录入'); m.remove(); loadManage('ent');
  };
}

async function openPositionModal() {
  const ents = await API('/api/enterprises');
  const opts = ents.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  const m = modal(`<h3>发布岗位</h3><div class="form-grid">
    <div><label class="fld">所属企业</label><select id="p-ent">${opts}</select></div>
    <div><label class="fld">岗位名称</label><input id="p-title" placeholder="Java 后端开发"></div>
    <div class="form-grid two"><div><label class="fld">城市</label><input id="p-city"></div><div><label class="fld">薪资</label><input id="p-salary"></div></div>
    <div class="form-grid two"><div><label class="fld">行业</label><input id="p-ind"></div><div><label class="fld">要求专业(逗号)</label><input id="p-majors"></div></div>
    <div><label class="fld">技能要求(逗号)</label><input id="p-skills"></div>
    <div><label class="fld">描述</label><textarea id="p-req" rows="2"></textarea></div>
    <button class="primary" id="savePos">发布</button></div>`);
  $('#savePos', m).onclick = async () => {
    const body = {
      enterpriseId: $('#p-ent', m).value, title: $('#p-title', m).value.trim(), city: $('#p-city', m).value.trim(),
      salary: $('#p-salary', m).value.trim(), industry: $('#p-ind', m).value.trim(),
      requiredMajors: $('#p-majors', m).value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      skills: $('#p-skills', m).value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      requirements: $('#p-req', m).value.trim()
    };
    if (!body.title) return toast('请填写岗位名称');
    await API('/api/positions', 'POST', body); toast('岗位已发布'); m.remove(); loadManage('pos');
  };
}

async function openFollowModal(recId) {
  const list = await API('/api/recommendations');
  const rec = list.find(r => r.id === recId);
  const f = rec && rec.followup;
  const m = modal(`<h3>更新跟进</h3><div class="form-grid">
    <div class="form-grid two"><div><label class="fld">面试时间</label><input id="f-time" value="${f ? f.interviewTime || '' : ''}" placeholder="2026-09-10 14:00"></div><div><label class="fld">面试地点</label><input id="f-place" value="${f ? f.interviewPlace || '' : ''}" placeholder="腾讯大厦 3F"></div></div>
    <div class="form-grid two"><div><label class="fld">面试结果</label><select id="f-result"><option value="">未面试</option><option value="通过" ${f && f.interviewResult === '通过' ? 'selected' : ''}>通过</option><option value="未通过" ${f && f.interviewResult === '未通过' ? 'selected' : ''}>未通过</option></select></div><div><label class="fld">签约状态</label><select id="f-sign"><option value="">未签约</option><option value="signed" ${f && f.signStatus === 'signed' ? 'selected' : ''}>已签约</option></select></div></div>
    <div><label class="fld">录用通知书/备注</label><input id="f-offer" value="${f ? f.offerLetter || '' : ''}" placeholder="已发 offer，薪资 18k"></div>
    <button class="primary" id="saveFollow">保存跟进</button></div>`);
  $('#saveFollow', m).onclick = async () => {
    await API(`/api/recommendations/${recId}/followup`, 'POST', {
      interviewTime: $('#f-time', m).value.trim(), interviewPlace: $('#f-place', m).value.trim(),
      interviewResult: $('#f-result', m).value, signStatus: $('#f-sign', m).value, offerLetter: $('#f-offer', m).value.trim()
    });
    toast('跟进已更新'); m.remove(); renderView();
  };
}

// ---------- 启动 ----------
bindLogin();
$('#logoutBtn').onclick = () => { state.user = null; $('#main').classList.add('hidden'); $('#login').classList.remove('hidden'); };
