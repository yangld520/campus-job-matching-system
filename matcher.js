// matcher.js —— 标准化匹配度计算模型
const db = require('./db');

function computeMatch(student, position, rules) {
  const w = rules.weights;
  const detail = {};

  // 1) 专业匹配
  let majorScore = 5;
  const reqMajors = position.requiredMajors || [];
  if (reqMajors.includes(student.major)) {
    majorScore = w.majorExact;
  } else if (reqMajors.some(m => m.slice(0, 2) === student.major.slice(0, 2))) {
    majorScore = w.majorRelated;
  }
  detail.majorScore = majorScore;

  // 2) 技能匹配
  const posSkills = position.skills || [];
  const stuSkills = student.skills || [];
  const overlap = posSkills.filter(s => stuSkills.includes(s)).length;
  const skillScore = posSkills.length ? Math.round((overlap / posSkills.length) * w.skill) : Math.round(w.skill * 0.3);
  detail.skillScore = skillScore;
  detail.overlap = overlap;

  // 3) 学业（GPA）
  const gpaNorm = Math.min(1, (student.gpa || 0) / 4);
  const gpaScore = Math.round(gpaNorm * w.gpa);
  detail.gpaScore = gpaScore;

  // 4) 求职意向
  let intScore = 0;
  if (student.intention) {
    if (student.intention.industry && position.industry === student.intention.industry) intScore += w.intIndustry;
    if (student.intention.city && position.city === student.intention.city) intScore += w.intCity;
  }
  detail.intScore = intScore;

  // 5) 实习经历
  const internScore = student.internship ? w.internship : 0;
  detail.internScore = internScore;

  let score = majorScore + skillScore + gpaScore + intScore + internScore;
  score = Math.min(100, score);

  let level = '低匹配';
  if (score >= rules.thresholds.high) level = '高匹配';
  else if (score >= rules.thresholds.mid) level = '中匹配';

  return { score, level, detail: { ...detail, overlap, reqMajors } };
}

// 执行全量匹配：对每位活跃学生 × 开放岗位计算，达标则生成/更新推荐记录与推送记录
function runMatching() {
  const data = db.load();
  const rules = data.matchRules;
  const students = data.students;
  const positions = data.positions.filter(p => p.status === 'open');

  let created = 0, updated = 0;
  const generated = [];

  students.forEach(student => {
    positions.forEach(position => {
      const m = computeMatch(student, position, rules);
      if (m.level === '低匹配') return; // 仅高/中匹配进入推荐

      const exist = data.recommendations.find(r => r.studentId === student.id && r.positionId === position.id);
      if (exist) {
        exist.score = m.score;
        exist.level = m.level;
        exist.detail = m.detail;
        exist.status = exist.status || 'pending';
        updated++;
        generated.push(exist);
      } else {
        const rec = {
          id: db.gid('rec'),
          studentId: student.id,
          positionId: position.id,
          score: m.score,
          level: m.level,
          detail: m.detail,
          status: 'pending',
          createdAt: db.now()
        };
        data.recommendations.push(rec);
        // 双向推送记录
        data.pushes.push({ id: db.gid('ps'), recommendationId: rec.id, direction: 'student', status: 'pending', at: null });
        data.pushes.push({ id: db.gid('ps'), recommendationId: rec.id, direction: 'enterprise', status: 'pending', at: null });
        created++;
        generated.push(rec);
      }
    });
  });

  db.save();
  return { created, updated, total: data.recommendations.length, generated };
}

module.exports = { computeMatch, runMatching };
