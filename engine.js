/* ==========================================================================
   工银智养仓 · 税额计算内核 engine.js
   --------------------------------------------------------------------------
   公众适配自测（index.html）与手机银行完整判断（app-demo.html）共用此文件。

   设计约束（重要，改动前先读）：
   1. 零 DOM 依赖 —— 不引用 window / document，Node 里可直接 require，
      否则 parity_test.py 的对照测试跑不起来。
   2. 无状态 —— 所有函数是纯函数，只依赖入参和下方常量。
   3. 税率表只此一份 —— 两版不得各自内联副本，否则「同一套规则」不可验证。

   口径（与方案书 3.2 / 3.4 一致）：
   - T0 = 扣除基本减除费用、专项扣除及专项附加扣除后的全年应纳税所得额，
     不是月薪、不是税前收入。
   - LIMIT = 12,000 元/年，缴费在限额内据实扣除。
   - 领取环节按 3% 单独计税（本文件不参与领取端计算）。
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;          // Node：parity_test.py 用
  } else {
    root.ENGINE = api;             // 浏览器：两版页面共用
    // 同时平铺到全局，便于既有页面里直接写 taxOf(...) / saving(...)
    for (var k in api) { if (api.hasOwnProperty(k)) root[k] = api[k]; }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 七档综合所得税率表（年度） */
  var BRACKETS = [
    [36000, .03], [144000, .10], [300000, .20], [420000, .25],
    [660000, .30], [960000, .35], [null, .45]
  ];
  var LIMIT = 12000;

  /* 缴存前全年应纳税所得额 t0 对应的税额 */
  function taxOf(t0) {
    if (!(t0 > 0)) return 0;
    var total = 0, low = 0;
    for (var i = 0; i < BRACKETS.length; i++) {
      var cap = BRACKETS[i][0], rate = BRACKETS[i][1];
      if (cap === null || t0 <= cap) { total += (t0 - low) * rate; break; }
      total += (cap - low) * rate; low = cap;
    }
    return total;
  }

  /* t0 所处的最高边际税率 */
  function rateOf(t0) {
    for (var i = 0; i < BRACKETS.length; i++) {
      var cap = BRACKETS[i][0];
      if (cap === null || t0 <= cap) return BRACKETS[i][1];
    }
    return 0;
  }

  /* 分段明细，供「为什么不能直接乘最高税率」的解释使用 */
  function breakdown(t0) {
    var rows = [];
    if (!(t0 > 0)) return rows;
    var low = 0;
    for (var i = 0; i < BRACKETS.length; i++) {
      var cap = BRACKETS[i][0], rate = BRACKETS[i][1];
      var hi = (cap === null) ? t0 : Math.min(t0, cap);
      if (hi > low) rows.push({ low: low, amt: hi - low, rate: rate, tax: (hi - low) * rate });
      if (cap === null || t0 <= cap) break;
      low = cap;
    }
    return rows;
  }

  /* 缴存 deposit 后的当期少缴税款 */
  function saving(t0, deposit) {
    deposit = Math.max(0, Math.min(deposit == null ? LIMIT : deposit, LIMIT));
    var t1 = Math.max(0, t0 - deposit);
    var before = taxOf(t0), after = taxOf(t1);
    return {
      t0: t0, deposit: deposit, t1: t1,
      before: before, after: after,
      save: before - after,
      naive: deposit * rateOf(t0),          // 错误算法：缴存额 × 最高档
      cross: rateOf(t1) !== rateOf(t0),     // 是否跨档
      rb: rateOf(t0), ra: rateOf(t1)
    };
  }

  /* 七档区间选项，供「不知道自己的 T0」时选择 */
  var RANGES = [
    { key: 'r0',  label: '12 万元以下',            hi: 120000 },
    { key: 'r1',  label: '12 万 – 30 万元',        hi: 300000 },
    { key: 'r2',  label: '30 万 – 42 万元',        hi: 420000 },
    { key: 'r3',  label: '42 万 – 66 万元',        hi: 660000 },
    { key: 'r4',  label: '66 万 – 96 万元',        hi: 960000 },
    { key: 'r5',  label: '96 万元以上',            hi: null   }
  ];

  /* 自检：与 engine.py 的 ALL PASS 一致，任何一处不符都应视为回归 */
  function selfTest() {
    var cases = [[42000, 780], [180000, 2400], [500000, 3600], [36000, 360],
                 [24000, 360], [0, 0], [1200000, 5400]];
    var bad = [];
    for (var i = 0; i < cases.length; i++) {
      var t0 = cases[i][0], want = cases[i][1];
      var got = Math.round(saving(t0, LIMIT).save);
      if (got !== want) bad.push('T0=' + t0 + ' 得 ' + got + ' 期望 ' + want);
    }
    return bad;
  }

  return {
    BRACKETS: BRACKETS,
    LIMIT: LIMIT,
    RANGES: RANGES,
    taxOf: taxOf,
    rateOf: rateOf,
    breakdown: breakdown,
    saving: saving,
    selfTest: selfTest
  };
});
