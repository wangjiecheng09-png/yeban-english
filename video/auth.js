/* ============================================================================
   video/auth.js — Supabase 服务器验证 · SITE VERSION
   现在的状态：服务器开关是关的（SERVER_AUTH_ENABLED=false，anon key 为空），
   网站行为和以前一模一样——登录卡显示“即将开通”，兑换走本机验证。
   切换时只改两处：把 SUPABASE_ANON_KEY 填上（Supabase 控制台 →
   Settings → API → anon public），再把 SERVER_AUTH_ENABLED 改成 true。
   切换之后：魔法链接登录、兑换走服务器 verify_code、进度/打卡同步；
   access.js 一个字不动（它只读本机 yeban-entitlement，auth.js 负责把
   服务器的权益同步到本机）。service_role key 绝不能放进这个文件。
   ========================================================================== */
(function () {
'use strict';

/* ---- 配置 ---- */
var SUPABASE_URL = 'https://hneixuznwsymiuamwkcp.supabase.co';
/* anon public key：公开钥匙，放前端代码里是安全的（真正保护数据的是
   RLS）。填控制台 Settings → API → Project API keys → anon public。
   填之前这里留空，auth.js 不会启用服务器模式。 */
var SUPABASE_ANON_KEY = '';
/* 开关：false = 本机验证（现在的行为，一模一样）；true = 服务器验证。
   只有你点头切换时才改成 true。 */
var SERVER_AUTH_ENABLED = false;

/* ---- 服务器模式是否真的可用 ---- */
function serverAvailable() {
  return SERVER_AUTH_ENABLED && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}
window.YebanServerAvailable = serverAvailable;

/* ---- 工具：用页面现成的函数（index.html 里已有），没有就用后备 ---- */
function getEnt() {
  if (typeof window.getEntitlement === 'function') return window.getEntitlement();
  try { var e = JSON.parse(localStorage.getItem('yeban-entitlement') || '{}'); return e && typeof e === 'object' ? e : {}; } catch (err) { return {}; }
}
function saveEnt(e) {
  if (typeof window.saveEntitlement === 'function') return window.saveEntitlement(e);
  localStorage.setItem('yeban-entitlement', JSON.stringify(e));
}
function renderMemberSafe() {
  if (typeof window.renderMember === 'function') { try { window.renderMember(); } catch (err) {} }
}
function renderLoginSafe() {
  if (typeof window.updateLoginUI === 'function') { try { window.updateLoginUI(); } catch (err) {} }
}
function normCode(s) {
  if (typeof window.normalizeCode === 'function') return window.normalizeCode(s);
  return (s || '').replace(/[\s\u3000]+/g, '').replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }).toUpperCase();
}
function shanghaiTodayKey() {
  if (typeof window.shanghaiToday === 'function') return window.shanghaiToday().key;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
/* 服务器 kind/ref → 本机权益形状（跟 index.html 的 renderMember / boughtPacks 一致） */
var VIP_TIER = { 'vip-m': 'month', 'vip-q': 'quarter', 'vip-y': 'year' };
function applyServerEntitlement(ent, kind, ref, until) {
  if (kind === 'vip') {
    var tier = VIP_TIER[ref];
    if (!tier) return false;
    ent.vip = { tier: tier, until: until };
  } else {
    /* lesson / collection / bundle 都是买断，ref 原样进 buyout */
    ent.buyout = ent.buyout || [];
    if (ent.buyout.indexOf(ref) < 0) ent.buyout.push(ref);
  }
  return true;
}

/* ---- Supabase 客户端（只在服务器模式开时才加载） ---- */
var supabase = null;
var supabaseReady = null;
function loadSupabase() {
  if (supabaseReady) return supabaseReady;
  supabaseReady = new Promise(function (resolve, reject) {
    if (!serverAvailable()) { reject(new Error('server auth not enabled')); return; }
    if (window.supabase && window.supabase.createClient) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      resolve(supabase); return;
    }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = function () {
      try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        resolve(supabase);
      } catch (err) { reject(err); }
    };
    s.onerror = function () { reject(new Error('supabase-js CDN failed')); };
    document.head.appendChild(s);
  });
  return supabaseReady;
}
function getClient() { return supabase; }
window.YebanAuth = {
  enabled: serverAvailable,
  load: loadSupabase,
  client: getClient,
  login: sendMagicLink,
  logout: logout,
  currentUser: currentUser,
  redeem: redeemCodeServer,
  syncNow: syncNow,
  markLessonDone: markLessonDoneServer,
  checkin: checkinServer
};

/* ---- 登录：魔法链接（输邮箱 → 收邮件 → 点链接登录，不用密码） ---- */
function sendMagicLink(email) {
  return loadSupabase().then(function (client) {
    return client.auth.signInWithOtp({ email: (email || '').trim() });
  });
}
function logout() {
  if (!supabase) return Promise.resolve();
  return supabase.auth.signOut();
}
function currentUser() {
  if (!supabase) return Promise.resolve(null);
  return supabase.auth.getUser().then(function (r) { return r.data ? r.data.user : null; });
}

/* ---- 登录后第一次：建 users 行 + 同步 ---- */
function ensureUserRow(client, user) {
  var name = '';
  try { name = (localStorage.getItem('yeban-username') || '').trim() || '夜班学员'; } catch (err) { name = '夜班学员'; }
  return client.from('users').upsert(
    { id: user.id, email: user.email, display_name: name },
    { onConflict: 'id' }
  );
}
/* 服务器权益 → 本机（真相在服务器，本机是缓存） */
function syncDownEntitlements(client, user) {
  return client.from('entitlements').select('kind,ref,until').eq('user_id', user.id)
    .then(function (r) {
      if (r.error) throw r.error;
      var ent = {};
      (r.data || []).forEach(function (row) {
        applyServerEntitlement(ent, row.kind, row.ref, row.until);
      });
      /* 服务器有记录就以服务器为准；服务器没记录（新号）就不动本机缓存 */
      if ((r.data || []).length) saveEnt(ent);
      return ent;
    });
}
/* 进度/打卡：本机和服务器取并集，再写回两边（以后以服务器为准） */
function localProgress() {
  var out = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('classroom-') === 0 && k.slice(-5) === '-done') {
        var lesson = k.slice(10, -5);
        var mistakes = [];
        try { mistakes = JSON.parse(localStorage.getItem('classroom-' + lesson + '-mistakes') || '[]'); } catch (err) { mistakes = []; }
        out[lesson] = { done: localStorage.getItem(k) === '1', mistakes: Array.isArray(mistakes) ? mistakes : [] };
      }
    }
  } catch (err) {}
  return out;
}
function localCheckinDays() {
  try { var a = JSON.parse(localStorage.getItem('yeban-checkin-days') || '[]'); return Array.isArray(a) ? a : []; } catch (err) { return []; }
}
function syncProgressAndCheckins(client, user) {
  var lp = localProgress();
  var days = localCheckinDays();
  return client.from('progress').select('lesson,done,mistakes').eq('user_id', user.id)
    .then(function (r) {
      if (r.error) throw r.error;
      var merged = {};
      (r.data || []).forEach(function (row) { merged[row.lesson] = { done: !!row.done, mistakes: Array.isArray(row.mistakes) ? row.mistakes : [] }; });
      Object.keys(lp).forEach(function (lesson) {
        var m = merged[lesson] || { done: false, mistakes: [] };
        m.done = m.done || lp[lesson].done;
        var set = {};
        m.mistakes.concat(lp[lesson].mistakes).forEach(function (x) { set[x] = 1; });
        m.mistakes = Object.keys(set);
        merged[lesson] = m;
      });
      var rows = Object.keys(merged).map(function (lesson) {
        return { user_id: user.id, lesson: lesson, done: merged[lesson].done, mistakes: merged[lesson].mistakes };
      });
      var up = rows.length ? client.from('progress').upsert(rows, { onConflict: 'user_id,lesson' }) : Promise.resolve({ error: null });
      return up.then(function (u) {
        if (u.error) throw u.error;
        /* 写回本机（服务器为准） */
        Object.keys(merged).forEach(function (lesson) {
          try {
            localStorage.setItem('classroom-' + lesson + '-done', merged[lesson].done ? '1' : '0');
            localStorage.setItem('classroom-' + lesson + '-mistakes', JSON.stringify(merged[lesson].mistakes));
          } catch (err) {}
        });
        return client.from('checkins').select('day').eq('user_id', user.id);
      });
    })
    .then(function (r) {
      if (r.error) throw r.error;
      var set = {};
      (r.data || []).forEach(function (row) { set[row.day] = 1; });
      days.forEach(function (d) { set[d] = 1; });
      var all = Object.keys(set).sort();
      var rows = all.map(function (d) { return { user_id: user.id, day: d }; });
      var up = rows.length ? client.from('checkins').upsert(rows, { onConflict: 'user_id,day' }) : Promise.resolve({ error: null });
      return up.then(function (u) {
        if (u.error) throw u.error;
        try { localStorage.setItem('yeban-checkin-days', JSON.stringify(all)); } catch (err) {}
        return all;
      });
    });
}
function syncNow() {
  return loadSupabase().then(function (client) {
    return currentUser().then(function (user) {
      if (!user) throw new Error('not logged in');
      return ensureUserRow(client, user)
        .then(function () { return syncDownEntitlements(client, user); })
        .then(function () { return syncProgressAndCheckins(client, user); })
        .then(function () { renderMemberSafe(); return true; });
    });
  });
}

/* ---- 兑码（服务器版）：先要求登录，再调 verify_code ---- */
function redeemCodeServer(codeRaw) {
  var msg = document.getElementById('redeemMsg');
  function fail(text) { if (msg) { msg.className = 'err'; msg.textContent = text; } return { ok: false, error: text }; }
  var code = normCode(codeRaw);
  if (!code) return Promise.resolve(fail('先输入兑换码。'));
  return loadSupabase().then(function (client) {
    return currentUser().then(function (user) {
      if (!user) { fail('先登录：输邮箱收一封登录链接，点开就登录了，再回来兑码。'); return { ok: false, error: 'not_logged_in' }; }
      return client.rpc('verify_code', { p_code: code, p_user: user.id })
        .then(function (r) {
          if (r.error) throw r.error;
          var d = r.data || {};
          if (!d.ok) {
            if (d.error === 'not_found') return fail('这个码不对，再看一眼，是不是字母输错了？');
            if (d.error === 'already_used') { renderMemberSafe(); return fail('这个码已经用过啦——一个码只能用一次。去上面“我的会员”看一眼，已经开通过了。'); }
            if (d.error === 'expired') return fail('这个码已经过期了。');
            return fail('兑换失败：' + (d.error || '未知错误'));
          }
          var ent = getEnt();
          if (!applyServerEntitlement(ent, d.kind, d.ref, d.until)) return fail('服务器返回了看不懂的权益，请截图发给 Koda。');
          saveEnt(ent);
          var inp = document.getElementById('redeemInput');
          if (inp) inp.value = '';
          if (msg) {
            msg.className = 'ok';
            if (d.kind === 'vip') {
              var tierName = { month: '月会员', quarter: '季会员', year: '年会员' }[VIP_TIER[d.ref]] || '会员';
              msg.textContent = '✅ 开通成功！' + tierName + '已开通，到期时间 ' + d.until + '。';
            } else {
              var name = (typeof window.packDisplayName === 'function') ? window.packDisplayName(d.ref) : d.ref;
              msg.textContent = '✅ 开通成功！' + name + '已买断，不限期。';
            }
          }
          renderMemberSafe();
          return { ok: true, kind: d.kind, ref: d.ref, until: d.until, entitlement_id: d.entitlement_id };
        });
    });
  }).catch(function (err) {
    /* 服务器连不上（没网、项目暂停）→ 告诉用户，行为退回本机，不丢数据 */
    var text = '服务器现在连不上（可能是没网，或者 Supabase 项目暂停了），先按本机方式兑换，等网络好了再同步。';
    if (msg) { msg.className = 'err'; msg.textContent = text; }
    return { ok: false, error: 'server_unreachable', detail: String(err && err.message || err) };
  });
}

/* ---- 学完打勾 / 打卡：写本机 + 往服务器补一份（连不上就只写本机） ---- */
function markLessonDoneServer(lesson, done, mistakes) {
  try {
    localStorage.setItem('classroom-' + lesson + '-done', done ? '1' : '0');
    localStorage.setItem('classroom-' + lesson + '-mistakes', JSON.stringify(mistakes || []));
  } catch (err) {}
  if (!serverAvailable() || !supabase) return Promise.resolve(false);
  return currentUser().then(function (user) {
    if (!user) return false;
    return supabase.from('progress').upsert(
      { user_id: user.id, lesson: lesson, done: !!done, mistakes: mistakes || [] },
      { onConflict: 'user_id,lesson' }
    ).then(function (r) { return !r.error; });
  }).catch(function () { return false; });
}
function checkinServer(day) {
  var d = day || shanghaiTodayKey();
  try {
    var a = localCheckinDays();
    if (a.indexOf(d) < 0) { a.push(d); localStorage.setItem('yeban-checkin-days', JSON.stringify(a)); }
  } catch (err) {}
  if (!serverAvailable() || !supabase) return Promise.resolve(false);
  return currentUser().then(function (user) {
    if (!user) return false;
    return supabase.from('checkins').upsert(
      { user_id: user.id, day: d },
      { onConflict: 'user_id,day' }
    ).then(function (r) { return !r.error; });
  }).catch(function () { return false; });
}

/* ---- 接线（只在服务器模式开时）：登录后自动同步；兑换改走服务器 ---- */
if (serverAvailable()) {
  loadSupabase().then(function (client) {
    client.auth.onAuthStateChange(function (event, session) {
      if (session && session.user) {
        ensureUserRow(client, session.user)
          .then(function () { return syncDownEntitlements(client, session.user); })
          .then(function () { return syncProgressAndCheckins(client, session.user); })
          .then(function () { renderMemberSafe(); renderLoginSafe(); })
          .catch(function () { /* 同步失败不影响本机使用，下次打开再补 */ });
      }
    });
    /* 兑换改走服务器；本机版留作后备（window.redeemCodeLocal） */
    if (typeof window.redeemCode === 'function') window.redeemCodeLocal = window.redeemCode;
    window.redeemCode = function () {
      var inp = document.getElementById('redeemInput');
      return redeemCodeServer(inp ? inp.value : '');
    };
  }).catch(function () { /* CDN 失败 → 保持本机验证 */ });
}
})();
