// FluxLedger PR3 托管隔离探针（T3.5，沿用 docs/hosted-validation-d2.md 的证据方式）
//
// 用法（浏览器操作由维护者执行）：
//   1. 把本文件整段内容粘贴进托管测试站的浏览器控制台（每次换账号后重新粘贴一次即可）；
//   2. 账号 A 登录后执行：  await pr3WriteMark('A')
//   3. 账号 B 登录后执行：  await pr3WriteMark('B')
//   4. 回到账号 A 再执行：  await pr3CheckIsolation('A', 'B')
//      （也可在 B 下执行 pr3CheckIsolation('B', 'A') 做反向检查）
//   5. 把每步返回的 JSON 贴回验证记录（脱敏：不含真实 user id / Cookie / token）。
//
// 约束：只使用脚本造出来的数据（标记形如 pr3-iso-<时间戳>-<label>），不承载真实账单；
// 写入是「先 GET 自己的文档、追加探针、再 PUT」，不可能触碰他人数据。
// 游客 401 检查见 docs/hosted-validation-pr3.md（无需登录，直接 fetch 即可）。
//
// 标记保存在中立 localStorage 键 pr3-iso-marks（登录/退出是整页跳转，window 变量会丢；
// 该键只存「标记字符串」，不属于任何账户命名空间，退出清理不会触碰，验证后可手动清除：
// localStorage.removeItem('pr3-iso-marks')）。

const PR3_MARKS_KEY = 'pr3-iso-marks';
const pr3LoadMarks = () => {
  try { return JSON.parse(localStorage.getItem(PR3_MARKS_KEY)) || {}; } catch { return {}; }
};
const pr3SaveMarks = marks => localStorage.setItem(PR3_MARKS_KEY, JSON.stringify(marks));

window.pr3WriteMark = async function pr3WriteMark(accountLabel) {
  const mark = 'pr3-iso-' + Date.now() + '-' + accountLabel;
  const whoami = await fetch('/api/whoami', { headers: { accept: 'application/json' } });
  if (whoami.status !== 200) {
    return { accountLabel, whoamiStatus: whoami.status, pass: false, reason: 'unauthenticated（登录后才应是 200）' };
  }
  const me = await whoami.json();
  const first = await fetch('/api/ledger', { headers: { accept: 'application/json' } });
  if (first.status !== 200) {
    return { accountLabel, whoamiStatus: 200, getStatus: first.status, pass: false, reason: 'GET /api/ledger failed' };
  }
  const current = await first.json();
  const base = current.data && current.data.transactions
    ? current.data
    : { transactions: [], cards: [], hiddenBuiltInCardIds: [] };
  const probe = {
    id: mark,
    type: 'expense',
    card: (base.cards[0] && base.cards[0].id) || 'probe-account',
    amount: 1,
    date: '2026-01-01',
    category: 'Other',
    description: mark,
  };
  const put = await fetch('/api/ledger', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: {
        transactions: [...base.transactions, probe],
        cards: base.cards,
        hiddenBuiltInCardIds: base.hiddenBuiltInCardIds,
      },
      baseVersion: current.version,
      expectedUserId: me.userId, // 服务端同一请求内的身份一致性校验（缺失会被 400 拒绝）
    }),
  });
  if (!put.ok) {
    return { accountLabel, whoamiStatus: 200, getStatus: 200, putStatus: put.status, pass: false, reason: 'PUT 被拒（409 = baseVersion 过期，刷新页面后重跑）' };
  }
  const putBody = await put.json();
  const verifyBody = await (await fetch('/api/ledger', { headers: { accept: 'application/json' } })).json();
  const transactions = (verifyBody.data && verifyBody.data.transactions) || [];
  const ownProbeVisible = transactions.some(item => item.id === mark);
  if (ownProbeVisible) {
    const marks = pr3LoadMarks();
    marks[accountLabel] = [...(marks[accountLabel] || []), mark];
    pr3SaveMarks(marks);
  }
  return {
    accountLabel,
    whoamiStatus: 200,
    userIdMask: String(me.userId).slice(0, 2) + '…' + String(me.userId).slice(-4),
    baseVersion: current.version,
    newVersion: putBody.version,
    verifyVersion: verifyBody.version,
    myMark: mark,
    ownProbeVisible,
    pass: ownProbeVisible,
  };
};

window.pr3CheckIsolation = async function pr3CheckIsolation(ownLabel, otherLabel) {
  const verifyBody = await (await fetch('/api/ledger', { headers: { accept: 'application/json' } })).json();
  const transactions = (verifyBody.data && verifyBody.data.transactions) || [];
  const marks = pr3LoadMarks();
  const own = marks[ownLabel] || [];
  const other = marks[otherLabel] || [];
  // 没有双方标记就没有比较证据：宁判失败（附原因），不许缺证据时误报通过。
  if (!own.length || !other.length) {
    return {
      check: ownLabel + ' 必须看得到自己的标记、看不到 ' + otherLabel + ' 的标记',
      ownMarkVisible: false,
      otherMarkVisible: false,
      pass: false,
      missingMarks: [!own.length ? ownLabel : null, !other.length ? otherLabel : null].filter(Boolean),
      reason: '缺少比较证据：请先以两个账号分别执行 await pr3WriteMark(...) 记录标记，再执行本检查',
    };
  }
  const ownMarkVisible = transactions.some(item => own.includes(item.id));
  const otherMarkVisible = transactions.some(item => other.includes(item.id));
  return {
    check: ownLabel + ' 必须看得到自己的标记、看不到 ' + otherLabel + ' 的标记',
    ownMarks: own,
    otherMarksReferenced: other,
    ownMarkVisible,
    otherMarkVisible,
    pass: ownMarkVisible && !otherMarkVisible,
  };
};

console.info('已加载。步骤：await pr3WriteMark("A") → 切账号 B：await pr3WriteMark("B") → 回账号 A：await pr3CheckIsolation("A","B")');
