// 업메리 상담 신청 폼 — 아임웹 "코드" 블록에 그대로 붙여 넣는 HTML을 만든다(2026-10 대표님 요청).
// 대시보드 "폼 코드 복사" 버튼이 Supabase 주소·공개(anon) 키·메타 픽셀 ID를 채워서 복사해 준다.
// · 제출 → Supabase leads에 직접 insert(공개 키 + RLS insert만 허용, return=minimal이라 읽기 권한 불필요)
// · 같은 순간 메타 픽셀 Lead 이벤트(eventID = 리드 ID → 다음 날 서버 전송과 메타가 중복 제거)
// · URL의 utm_*·fbclid를 읽어 같이 저장(이 페이지에 처음 들어올 때 값을 기억해 두었다가 다시 와도 씀)
// · 완료 후 완료 페이지로 이동(주소가 없으면 그 자리에 카톡 채널 추가 버튼을 보여줌)
// 키·이름·전화번호를 콘솔이나 다른 곳에 남기지 않는다.
import { DAILY_TIME_OPTIONS, TAROT_EXPERIENCE_OPTIONS } from '../types/lead'

export const UPMERY_KAKAO_CHAT_URL = 'https://pf.kakao.com/_lvxedX/chat'
export const UPMERY_KAKAO_ADD_URL = 'https://pf.kakao.com/_lvxedX/friend'

const TAROT_LABELS: Record<(typeof TAROT_EXPERIENCE_OPTIONS)[number], string> = {
  처음: '완전 처음이에요',
  배워봤음: '배워본 적 있어요',
  '상담 중': '이미 상담하고 있어요',
}

export interface LeadFormConfig {
  supabaseUrl: string
  supabaseKey: string
  pixelId?: string | null
  doneUrl?: string | null
}

const STYLE = `
.um-lead{max-width:440px;margin:0 auto;padding:24px 20px;border-radius:16px;background:#fff;color:#222;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;box-shadow:0 2px 16px rgba(0,0,0,.08);box-sizing:border-box}
.um-lead *{box-sizing:border-box}
.um-lead h3{margin:0 0 4px;font-size:20px;font-weight:800}
.um-lead .um-sub{margin:0 0 18px;font-size:14px;color:#666}
.um-lead label.um-f{display:block;margin:0 0 6px;font-size:14px;font-weight:700}
.um-lead input[type=text],.um-lead input[type=tel]{width:100%;height:46px;margin:0 0 14px;padding:0 12px;border:1px solid #ddd;border-radius:10px;font-size:16px}
.um-lead .um-opts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.um-lead .um-opts label{flex:1 1 auto;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;text-align:center;cursor:pointer}
.um-lead .um-opts input{display:none}
.um-lead .um-opts input:checked+span{font-weight:800;color:#e8590c}
.um-lead .um-opts label:has(input:checked){border-color:#e8590c;background:#fff4ec}
.um-lead .um-consent{display:flex;gap:8px;align-items:flex-start;margin:4px 0 6px;font-size:13px}
.um-lead .um-consent input{margin-top:3px}
.um-lead details{margin:0 0 16px;font-size:12px;color:#666}
.um-lead details p{margin:6px 0 0;line-height:1.6}
.um-lead button{width:100%;height:52px;border:0;border-radius:12px;background:#e8590c;color:#fff;font-size:17px;font-weight:800;cursor:pointer}
.um-lead button:disabled{opacity:.6}
.um-lead .um-err{min-height:18px;margin:8px 0 0;font-size:13px;color:#d6336c;text-align:center}
.um-lead .um-alt{display:block;margin:14px 0 0;font-size:13px;color:#888;text-align:center}
.um-lead .um-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.um-lead .um-done{text-align:center}
.um-lead .um-done a{display:block;margin:10px 0 0;padding:14px;border-radius:12px;background:#fee500;color:#191919;font-weight:800;text-decoration:none}
`

function radioGroup(name: string, options: readonly string[], labels?: Record<string, string>): string {
  return `<div class="um-opts">${options
    .map((v) => `<label><input type="radio" name="${name}" value="${v}" required><span>${labels?.[v] ?? v}</span></label>`)
    .join('')}</div>`
}

export function buildLeadFormSnippet(cfg: LeadFormConfig): string {
  const config = JSON.stringify({
    url: cfg.supabaseUrl.replace(/\/+$/, ''),
    key: cfg.supabaseKey,
    pixel: cfg.pixelId || '',
    done: cfg.doneUrl || '',
    kakaoAdd: UPMERY_KAKAO_ADD_URL,
  })
  return `<!-- 업메리 상담 신청 폼 (대시보드에서 복사한 코드 — 직접 고치지 마세요) -->
<style>${STYLE}</style>
<div class="um-lead" id="um-lead">
  <form id="um-lead-form" novalidate>
    <h3>무료 상담 신청</h3>
    <p class="um-sub">남겨주시면 카톡이나 전화로 먼저 연락드릴게요.</p>
    <label class="um-f" for="um-name">이름</label>
    <input type="text" id="um-name" name="name" maxlength="20" autocomplete="name" required>
    <label class="um-f" for="um-phone">전화번호</label>
    <input type="tel" id="um-phone" name="phone" maxlength="13" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" required>
    <label class="um-f">타로 경험</label>
    ${radioGroup('tarot', TAROT_EXPERIENCE_OPTIONS, TAROT_LABELS)}
    <label class="um-f">하루에 쓸 수 있는 시간</label>
    ${radioGroup('time', DAILY_TIME_OPTIONS)}
    <div class="um-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
    <label class="um-consent"><input type="checkbox" name="consent" required><span><b>[필수]</b> 개인정보 수집·이용 및 광고 성과 측정을 위한 국외 이전에 동의합니다.</span></label>
    <details><summary>자세히 보기</summary>
      <p>· 수집 항목: 이름, 전화번호, 타로 경험, 하루 투자 가능 시간, 유입 정보(광고·링크 정보, 브라우저 정보)<br>
      · 이용 목적: 상담 안내 연락, 광고 성과 측정<br>
      · 보유 기간: 수집일로부터 1년, 동의를 철회하면 바로 파기<br>
      · 광고 성과 측정(국외 이전): 신청·상담·결제 여부를 메타 광고 성과 측정에 씁니다. 이때 전화번호는 되돌릴 수 없게 암호화(해시)한 값만 보냅니다.
      이전받는 자 Meta Platforms, Inc.(미국) / 이전 항목: 암호화한 전화번호, 신청·상담·결제 여부와 시각, 광고 클릭 정보 / 이전 시기·방법: 신청 직후와 다음 날 인터넷으로 전송 / 보유 기간: Meta 정책에 따름<br>
      · 동의하지 않으셔도 되지만, 그 경우 이 폼으로는 신청할 수 없어요(카톡 문의는 가능해요).</p>
    </details>
    <button type="submit" id="um-submit">무료 상담 신청하기</button>
    <p class="um-err" id="um-err" role="alert"></p>
    <a class="um-alt" href="${UPMERY_KAKAO_CHAT_URL}" target="_blank" rel="noopener">카톡으로 먼저 물어볼게요</a>
  </form>
</div>
<script>
(function () {
  var C = ${config};
  var form = document.getElementById('um-lead-form');
  if (!form) return;
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid'];
  var STORE = 'um_lead_src';
  var params = new URLSearchParams(location.search);
  var src = {};
  var fromUrl = KEYS.some(function (k) { return params.get(k); });
  if (fromUrl) {
    KEYS.forEach(function (k) { src[k] = params.get(k) || null; });
    src.at = Date.now();
    try { localStorage.setItem(STORE, JSON.stringify(src)); } catch (e) {}
  } else {
    try { src = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { src = {}; }
  }
  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  if (C.pixel) {
    if (!window.fbq) {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', C.pixel);
      window.fbq('track', 'PageView');
    }
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  var err = document.getElementById('um-err');
  var btn = document.getElementById('um-submit');
  function fail(msg) { err.textContent = msg; btn.disabled = false; btn.textContent = '무료 상담 신청하기'; }
  function done() {
    if (C.done) { location.href = C.done; return; }
    document.getElementById('um-lead').innerHTML = '<div class="um-done"><h3>신청 완료!</h3><p class="um-sub">카톡 채널을 추가해 두시면 상담 안내를 바로 받아보실 수 있어요.</p><a href="' + C.kakaoAdd + '" target="_blank" rel="noopener">카카오톡 채널 추가하기</a></div>';
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    err.textContent = '';
    var fd = new FormData(form);
    if (fd.get('website')) { done(); return; }
    var name = String(fd.get('name') || '').trim();
    var phone = String(fd.get('phone') || '').replace(/[^0-9]/g, '');
    if (!name) return fail('이름을 적어주세요.');
    if (!/^01[016789][0-9]{7,8}$/.test(phone)) return fail('휴대폰 번호를 확인해 주세요.');
    if (!fd.get('tarot')) return fail('타로 경험을 골라주세요.');
    if (!fd.get('time')) return fail('하루에 쓸 수 있는 시간을 골라주세요.');
    if (!fd.get('consent')) return fail('개인정보 수집·이용에 동의해 주세요.');
    btn.disabled = true; btn.textContent = '신청하는 중…';
    var id = uuid();
    var fbclid = src.fbclid || null;
    var fbc = cookie('_fbc') || (fbclid ? 'fb.1.' + (src.at || Date.now()) + '.' + fbclid : null);
    var row = {
      id: id, brand: '업메리', name: name, phone: phone,
      tarot_experience: String(fd.get('tarot')), daily_time: String(fd.get('time')),
      consent: true, consent_at: new Date().toISOString(),
      utm_source: src.utm_source || null, utm_medium: src.utm_medium || null,
      utm_campaign: src.utm_campaign || null, utm_content: src.utm_content || null,
      fbclid: fbclid, fbc: fbc, fbp: cookie('_fbp'),
      page_url: location.origin + location.pathname, user_agent: navigator.userAgent
    };
    fetch(C.url + '/rest/v1/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: C.key, Authorization: 'Bearer ' + C.key, Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      if (C.pixel && window.fbq) window.fbq('track', 'Lead', { content_name: '업메리 상담 신청' }, { eventID: id });
      setTimeout(done, 700);
    }).catch(function () {
      fail('신청이 안 됐어요. 잠시 뒤 다시 눌러주시거나 카톡으로 남겨주세요.');
    });
  });
})();
</script>`
}

// 완료 페이지(아임웹 별도 페이지)에 넣는 코드 — 카톡 채널 추가 버튼(보조로 1:1 채팅).
export function buildLeadDoneSnippet(): string {
  return `<!-- 업메리 상담 신청 완료 페이지 -->
<div style="max-width:440px;margin:0 auto;padding:32px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#222">
  <h3 style="margin:0 0 8px;font-size:22px;font-weight:800">신청 완료!</h3>
  <p style="margin:0 0 20px;font-size:15px;color:#666;line-height:1.6">곧 연락드릴게요.<br>카톡 채널을 추가해 두시면 상담 안내를 바로 받아보실 수 있어요.</p>
  <a href="${UPMERY_KAKAO_ADD_URL}" target="_blank" rel="noopener" style="display:block;padding:16px;border-radius:12px;background:#fee500;color:#191919;font-size:17px;font-weight:800;text-decoration:none">카카오톡 채널 추가하기</a>
  <a href="${UPMERY_KAKAO_CHAT_URL}" target="_blank" rel="noopener" style="display:block;margin-top:12px;font-size:14px;color:#888">카톡으로 먼저 물어보기</a>
</div>`
}
