/* 夜班英语 · 视频课权限（共享文件，唯一规则来源）
   第 1 课免费整节看；第 2–10 课视频按购买解锁（单课 lesson-epNN / 优惠包 bundle-w1a / 所属合集 coll-bN），会员永远不解锁视频；
   旧的 “week1” 权益已废弃，不再解锁任何东西（2026-11-06 决定）；本机留存的 week1 权益也不生效。
   文字（讲稿、笔记、讨论区）：视频权限或在期未过期会员。localStorage 键 'yeban-entitlement'，结构 {buyout:[...], vip:{tier,until}}。
   模块页 module-m1.html + 10 个详情页 detail-epNN-*.html 共用。改规则只改这里。
   各页在引用本文件后都有一段 2 行安全默认值：只有本文件没加载到时才生效（只放行免费第 1 课，其余全锁），不是规则的第二份拷贝。 */
function getEntitlement(){try{var e=JSON.parse(localStorage.getItem('yeban-entitlement')||'{}');return e&&typeof e==='object'?e:{};}catch(err){return{};}}
function shanghaiTodayKey(){try{var ps=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());var y=0,m=0,d=0;ps.forEach(function(p){if(p.type==="year")y=+p.value;if(p.type==="month")m=+p.value;if(p.type==="day")d=+p.value;});return y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");}catch(e){var n=new Date();return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0")+"-"+String(n.getDate()).padStart(2,"0");}}
function lessonCollection(n){return null;/* 模块 1 的课属于第 1 周课程，没有所属合集；以后模块复用时按课号返回合集包名，如 'coll-b1' */}
function hasVideoAccess(n){if(n===1)return true;var e=getEntitlement();var b=(e.buyout||[]);if(b.indexOf('bundle-w1a')>=0)return true;var nn=('0'+n).slice(-2);if(b.indexOf('lesson-ep'+nn)>=0)return true;var c=lessonCollection(n);if(c&&b.indexOf(c)>=0)return true;return false;}
function hasTextAccess(n){if(hasVideoAccess(n))return true;var e=getEntitlement();if(e.vip&&e.vip.until&&e.vip.until>=shanghaiTodayKey())return true;return false;}
/* 夜班重开第 2 关（输液 = 第 4 课场景）：会员在期内，或买断第 4 课（lesson-ep04）/ 优惠包（bundle-w1a）可玩；合集 A 单独不解锁。 */
function hasActiveVip(){var e=getEntitlement();return !!(e.vip&&e.vip.until&&e.vip.until>=shanghaiTodayKey());}
function hasGameLevel2(){return hasVideoAccess(4)||hasActiveVip();}
