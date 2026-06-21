
const BOT_UA = /facebookexternalhit|facebookcatalog|Facebot|Googlebot|Google-InspectionTool|AdsBot-Google|bingbot|YandexBot|Baiduspider|DuckDuckBot|Slurp|LinkedInBot|Twitterbot|Applebot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|GPTBot|ClaudeBot|anthropic-ai|Meta-ExternalAgent|Meta-ExternalFetcher|ia_archiver|archive\.org_bot/i;

const UTM_SAVE_SCRIPT = `<script>
(function(){
  var p=new URLSearchParams(window.location.search);
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','campaignid','adgroupid','keyword','matchtype','network'].forEach(function(k){var v=p.get(k);if(v)sessionStorage.setItem('ldr_'+k,v);});
})();
</` + `script>`;

const CALL_TRACK_SCRIPT = `<script data-ldr-call>
(function(){
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-tel-link]');
    if(!el)return;
    var m=document.cookie.match(/(?:^|;\\s*)ab_variant=([^;]+)/);
    var variant=(m&&['a','b'].includes(m[1]))?m[1]:'a';
    var device=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)?'mobile':'desktop';
    fetch('/api/track-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      event_type:'call',variant:variant,device:device,
      utms:{
        utm_source:sessionStorage.getItem('ldr_utm_source'),
        utm_medium:sessionStorage.getItem('ldr_utm_medium'),
        utm_campaign:sessionStorage.getItem('ldr_utm_campaign'),
        utm_content:sessionStorage.getItem('ldr_utm_content'),
        utm_term:sessionStorage.getItem('ldr_utm_term'),
        gclid:sessionStorage.getItem('ldr_gclid'),
        campaign_id:sessionStorage.getItem('ldr_campaignid'),
        ad_group_id:sessionStorage.getItem('ldr_adgroupid'),
        keyword:sessionStorage.getItem('ldr_keyword'),
        match_type:sessionStorage.getItem('ldr_matchtype'),
        network:sessionStorage.getItem('ldr_network')
      }
    })}).catch(function(){});
  });
})();
</` + `script>`;

function isBot(request) {
  return BOT_UA.test(request.headers.get('User-Agent') || '');
}

function getCookie(header, name) {
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function extractUtms(url) {
  return {
    utm_source:   url.searchParams.get('utm_source')   || null,
    utm_medium:   url.searchParams.get('utm_medium')   || null,
    utm_campaign: url.searchParams.get('utm_campaign') || null,
    utm_content:  url.searchParams.get('utm_content')  || null,
    utm_term:     url.searchParams.get('utm_term')     || null,
    gclid:        url.searchParams.get('gclid')        || null,
    campaign_id:  url.searchParams.get('campaignid')   || url.searchParams.get('campaign_id') || null,
    ad_group_id:  url.searchParams.get('adgroupid')    || url.searchParams.get('ad_group_id') || null,
    keyword:      url.searchParams.get('keyword')      || null,
    match_type:   url.searchParams.get('matchtype')    || null,
    network:      url.searchParams.get('network')      || null,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ── Meta Conversions API ────────────────────────────────────────────────────
// Server-side events fired alongside the client-side Pixel. Per-client config
// via secrets — if META_DATASET_ID / META_CAPI_TOKEN are unset, every call here
// is a silent no-op, so landers without CAPI deploy and run unchanged.
const META_API_VERSION = 'v19.0';

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const normEmail = e => (e ? String(e).trim().toLowerCase() : null);
const normName  = n => (n ? String(n).trim().toLowerCase() : null);
// US-centric: strip non-digits, prepend country code 1 if a bare 10-digit number.
function normPhone(p) {
  if (!p) return null;
  let d = String(p).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '1' + d;
  return d;
}

// Builds Meta user_data. PII (em/ph/fn/ln) is SHA-256 hashed; fbc/fbp/ip/ua are sent raw.
async function buildUserData({ email, phone, firstName, lastName, fbc, fbp, ip, ua } = {}) {
  const ud = {};
  const em = normEmail(email); if (em) ud.em = [await sha256Hex(em)];
  const ph = normPhone(phone); if (ph) ud.ph = [await sha256Hex(ph)];
  const fn = normName(firstName); if (fn) ud.fn = [await sha256Hex(fn)];
  const ln = normName(lastName);  if (ln) ud.ln = [await sha256Hex(ln)];
  if (fbc) ud.fbc = fbc;
  if (fbp) ud.fbp = fbp;
  if (ip)  ud.client_ip_address = ip;
  if (ua)  ud.client_user_agent = ua;
  return ud;
}

// Fires one event to the Conversions API. Returns {skipped:true} when CAPI isn't
// configured for this client. event_id matches the browser Pixel event for dedup.
async function sendMetaCapi(env, { eventName, eventId, eventSourceUrl, actionSource = 'website', userData, customData }) {
  if (!env.META_DATASET_ID || !env.META_CAPI_TOKEN) return { skipped: true };
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: actionSource,
      ...(eventId ? { event_id: eventId } : {}),
      ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
      user_data: userData,
      ...(customData ? { custom_data: customData } : {}),
    }],
    ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {}),
  };
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${env.META_DATASET_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const response = await res.json().catch(() => ({}));
  return { skipped: false, status: res.status, response };
}

// Cached per worker instance (cleared on each deploy)
let _cachedRound = null;

async function getCurrentRound(env) {
  if (_cachedRound !== null) return _cachedRound;
  try {
    const row = await env.DB.prepare('SELECT MAX(round_number) as r FROM rounds').first();
    _cachedRound = (row && row.r != null) ? row.r : 1;
  } catch {
    _cachedRound = 1;
  }
  return _cachedRound;
}

async function trackEvent(env, round, variant, eventType, utms = {}, extra = {}) {
  await env.DB.prepare(
    `INSERT INTO events (round, variant, event_type, device, lead_name, lead_email, lead_phone,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, campaign_id, ad_group_id, keyword, match_type, network)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    round, variant, eventType,
    extra.device     || null,
    extra.lead_name  || null,
    extra.lead_email || null,
    extra.lead_phone || null,
    utms.utm_source   || null, utms.utm_medium   || null,
    utms.utm_campaign || null, utms.utm_content  || null,
    utms.utm_term     || null,
    utms.gclid        || null, utms.campaign_id  || null,
    utms.ad_group_id  || null, utms.keyword      || null,
    utms.match_type   || null, utms.network      || null
  ).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p   = url.pathname;

    // ── API routes ────────────────────────────────────────────────────────────
    if (p === '/api/track-event' && request.method === 'POST') {
      if (!env.DB) return json({ ok: false }, 500);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const { event_type, variant, device, name, email, phone, utms = {}, event_id } = body;
      if (!['pageview','lead','call'].includes(event_type)) return json({ error: 'invalid event' }, 400);
      if (!['a','b'].includes(variant)) return json({ error: 'invalid variant' }, 400);
      const round = await getCurrentRound(env);
      await trackEvent(env, round, variant, event_type, {
        utm_source: utms.utm_source || null, utm_medium: utms.utm_medium || null,
        utm_campaign: utms.utm_campaign || null, utm_content: utms.utm_content || null,
        utm_term: utms.utm_term || null, gclid: utms.gclid || null,
        campaign_id: utms.campaign_id || null, ad_group_id: utms.ad_group_id || null,
        keyword: utms.keyword || null, match_type: utms.match_type || null,
        network: utms.network || null,
      }, { device, lead_name: name, lead_email: email, lead_phone: phone }).catch(() => {});

      // META-ONLY: fire the server-side Meta Lead (deduped against the browser Pixel via
      // event_id). sendMetaCapi no-ops unless META_DATASET_ID + META_CAPI_TOKEN are set, so
      // a Google-Ads-only client triggers nothing here. The worker never touches Google Ads.
      // _fbp/_fbc are first-party cookies on this domain and ride along on the same-origin fetch.
      if (event_type === 'lead') {
        const cookie = request.headers.get('Cookie') || '';
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        const userData = await buildUserData({
          email, phone,
          firstName: parts[0] || null,
          lastName:  parts.length > 1 ? parts.slice(1).join(' ') : null,
          fbc: getCookie(cookie, '_fbc'),
          fbp: getCookie(cookie, '_fbp'),
          ip:  request.headers.get('CF-Connecting-IP'),
          ua:  request.headers.get('User-Agent'),
        });
        ctx.waitUntil(sendMetaCapi(env, {
          eventName: 'Lead',
          eventId: event_id || null,
          eventSourceUrl: request.headers.get('Referer'),
          actionSource: 'website',
          userData,
        }).catch(() => {}));
      }
      return json({ ok: true });
    }

    // ── GHL qualified-call webhook → Meta Contact event ───────────────────────
    // GHL fires this on a completed call; we gate on duration and send a
    // server-side Contact event matched on the caller's hashed phone number.
    if (p === '/api/ghl-call' && request.method === 'POST') {
      if (!env.GHL_WEBHOOK_SECRET || request.headers.get('X-Webhook-Secret') !== env.GHL_WEBHOOK_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      // GHL nests the webhook's Custom Data under `customData`; standard contact fields sit at the
      // top level. Prefer customData, fall back to top-level so either GHL config shape works.
      const cd   = (body.customData && typeof body.customData === 'object') ? body.customData : {};
      const pick = (k) => { const v = cd[k]; return (v != null && v !== '') ? v : body[k]; };
      const duration    = parseInt(pick('call_duration'), 10) || 0;
      const minDuration = parseInt(env.CALL_MIN_DURATION, 10) || 30;
      if (duration < minDuration) return json({ ok: true, skipped: 'below_min_duration', duration });

      // fbclid comes from GHL's captured attribution (set when the visitor first landed) → far
      // stronger match than phone alone for a call.
      const attr   = (body.contact && (body.contact.attributionSource || body.contact.lastAttributionSource)) || {};
      const fbclid = pick('fbclid') || attr.fbclid || null;
      const userData = await buildUserData({
        phone: pick('phone'),
        firstName: pick('first_name'),
        lastName:  pick('last_name'),
        // No browser session for a call; derive fbc from the captured fbclid when available.
        fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : null,
      });
      if (!userData.ph && !userData.em) return json({ ok: true, skipped: 'no_match_key' });

      const result = await sendMetaCapi(env, {
        eventName: 'Contact',
        eventId: body.event_id || null,
        actionSource: 'phone_call',
        userData,
        customData: { call_duration: duration },
      });
      // Reports dashboard: log the qualified call ONLY when CAPI actually fired the Contact
      // (i.e. CAPI is configured). No variant — GHL can't attribute the call to A/B.
      if (env.DB && result && result.skipped !== true) {
        const round = await getCurrentRound(env);
        ctx.waitUntil(env.DB.prepare(
          "INSERT INTO events (round, variant, event_type, device, lead_phone) VALUES (?, NULL, 'qualified_call', 'phone', ?)"
        ).bind(round, pick('phone') || null).run().catch(() => {}));
      }
      return json({ ok: true, capi: result });
    }

    if (p === '/api/ab-stats') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);

      // Fetch all rounds metadata
      let roundsData = [];
      let currentRoundNum = 1;
      try {
        const roundsResult = await env.DB.prepare(
          'SELECT round_number, variant_a_label, variant_b_label, started_at FROM rounds ORDER BY round_number'
        ).all();
        roundsData = roundsResult.results;
        if (roundsData.length > 0) {
          currentRoundNum = roundsData[roundsData.length - 1].round_number;
        }
      } catch {
        // rounds table not yet created — fall back to unfiltered behavior
      }

      const roundParam = url.searchParams.get('round');
      const targetRound = roundParam ? parseInt(roundParam, 10) : currentRoundNum;

      const s = url.searchParams.get('start'), e = url.searchParams.get('end');
      const hasRange = s && e;
      const archWhere = '(archived IS NULL OR archived = 0)';

      let WHERE, binds;
      if (roundsData.length > 0) {
        if (hasRange) {
          WHERE = `WHERE ${archWhere} AND round = ? AND created_at >= ? AND created_at <= ?`;
          binds = [targetRound, s + ' 00:00:00', e + ' 23:59:59'];
        } else {
          WHERE = `WHERE ${archWhere} AND round = ?`;
          binds = [targetRound];
        }
      } else {
        if (hasRange) {
          WHERE = `WHERE ${archWhere} AND created_at >= ? AND created_at <= ?`;
          binds = [s + ' 00:00:00', e + ' 23:59:59'];
        } else {
          WHERE = `WHERE ${archWhere}`;
          binds = [];
        }
      }

      const [stats, devices, variantDevices, daily, recent, audit, qcalls] = await Promise.all([
        env.DB.prepare(`SELECT variant, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY variant, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT device, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY device, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT variant, device, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY variant, device, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT DATE(created_at) as day, variant, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY day, variant, event_type ORDER BY day`).bind(...binds).all(),
        env.DB.prepare(`SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, created_at FROM events ${WHERE} ORDER BY id DESC LIMIT 100`).bind(...binds).all(),
        env.DB.prepare(`SELECT id, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 100`).all(),
        env.DB.prepare(`SELECT COUNT(*) as count FROM events ${WHERE} AND event_type = 'qualified_call'`).bind(...binds).all(),
      ]);

      const variants = ['a', 'b'];
      const counts = {};
      for (const v of variants) counts[v] = { pageview: 0, lead: 0, call: 0 };
      for (const row of stats.results) {
        if (counts[row.variant] && counts[row.variant][row.event_type] !== undefined)
          counts[row.variant][row.event_type] += row.count;
      }
      const devCounts = {};
      for (const row of devices.results) {
        const d = row.device || 'unknown';
        if (!devCounts[d]) devCounts[d] = { pageview: 0, lead: 0, call: 0 };
        if (devCounts[d][row.event_type] !== undefined) devCounts[d][row.event_type] += row.count;
      }
      const varDevCounts = {};
      for (const row of variantDevices.results) {
        const v = row.variant, d = row.device || 'unknown';
        if (!varDevCounts[v]) varDevCounts[v] = {};
        if (!varDevCounts[v][d]) varDevCounts[v][d] = { pageview: 0, lead: 0, call: 0 };
        if (varDevCounts[v][d][row.event_type] !== undefined) varDevCounts[v][d][row.event_type] += row.count;
      }
      const buildDevice = (d, src) => {
        const s = (src || devCounts)[d] || { pageview: 0, lead: 0, call: 0 };
        return { views: s.pageview, leads: s.lead, calls: s.call, lead_cvr: s.pageview > 0 ? +(((s.lead + s.call) / s.pageview) * 100).toFixed(1) : 0 };
      };
      const variantData = {};
      let totalViews = 0, totalLeads = 0, totalCalls = 0;
      for (const v of variants) {
        const c = counts[v];
        variantData[v] = { views: c.pageview, leads: c.lead, calls: c.call, lead_cvr: c.pageview > 0 ? +(((c.lead + c.call) / c.pageview) * 100).toFixed(1) : 0 };
        totalViews += c.pageview; totalLeads += c.lead; totalCalls += c.call;
      }
      return json({
        rounds: roundsData,
        current_round: currentRoundNum,
        round: targetRound,
        variants: variantData,
        total: { views: totalViews, leads: totalLeads, calls: totalCalls, qualified_calls: (qcalls.results[0] && qcalls.results[0].count) || 0 },
        devices: { mobile: buildDevice('mobile'), desktop: buildDevice('desktop') },
        variant_devices: {
          a: { mobile: buildDevice('mobile', varDevCounts['a'] || {}), desktop: buildDevice('desktop', varDevCounts['a'] || {}) },
          b: { mobile: buildDevice('mobile', varDevCounts['b'] || {}), desktop: buildDevice('desktop', varDevCounts['b'] || {}) },
        },
        daily: daily.results,
        events: recent.results,
        audit_log: audit.results,
        updated_at: new Date().toISOString(),
      });
    }

    if (p === '/api/all-leads') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      const s = url.searchParams.get('start'), e = url.searchParams.get('end');
      const hasRange = s && e;
      const dateFilter = hasRange ? "WHERE (archived IS NULL OR archived = 0) AND event_type IN ('lead','call') AND created_at >= ? AND created_at <= ?" : "WHERE (archived IS NULL OR archived = 0) AND event_type IN ('lead','call')";
      const binds = hasRange ? [s + ' 00:00:00', e + ' 23:59:59'] : [];
      const result = await env.DB.prepare(`SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, created_at FROM events ${dateFilter} ORDER BY id DESC LIMIT 1000`).bind(...binds).all();
      return json({ events: result.results });
    }

    if (p === '/api/reset-stats' && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      await env.DB.prepare('UPDATE events SET archived = 1').run();
      await env.DB.prepare("INSERT INTO audit_log (action, detail) VALUES ('reset', 'Stats reset — events archived')").run();
      return json({ ok: true });
    }

    if (p === '/api/log-action' && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const validActions = ['add_variant', 'choose_winner', 'discard_variant', 'note'];
      if (!validActions.includes(body.action)) return json({ error: 'invalid action' }, 400);
      await env.DB.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').bind(body.action, body.detail || '').run();
      return json({ ok: true });
    }

    if (p === '/api/delete-event' && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const id = parseInt(body.id, 10);
      if (!id || isNaN(id)) return json({ error: 'invalid id' }, 400);
      await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    // ── Thank-you page: inject lead tracking script ───────────────────────────
    if (p === '/thank-you' || p === '/thank-you.html') {
      const asset = await env.ASSETS.fetch(new URL('/thank-you.html', request.url).toString());
      let html = await asset.text();
      if (!html.includes('/api/track-event')) {
        const leadScript = `<script>
(function() {
  if (sessionStorage.getItem('ldr_lead_tracked')) return;
  var m = document.cookie.match(/(?:^|;\\s*)ab_variant=([^;]+)/);
  var variant = (m && ['a','b'].includes(m[1])) ? m[1] : 'a';
  var p = new URLSearchParams(window.location.search);
  var device = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  var fullName  = p.get('name') || null;
  sessionStorage.setItem('ldr_lead_tracked', '1');
  // META-ONLY: the worker owns the Lead event for Facebook/Meta only. It never fires
  // or touches Google Ads conversions — those are your gtag snippet in the
  // CONVERSION TRACKING block, which runs independently. The fbq Lead below fires
  // ONLY when the Meta Pixel is present (window.fbq defined). No Pixel = no fire.
  // One event ID shared by the browser Pixel and the server CAPI event → Meta dedupes them.
  var eventId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'ld-' + Date.now() + '-' + Math.round(Math.random() * 1e9);
  if (typeof window.fbq === 'function') {
    try { fbq('track', 'Lead', {}, { eventID: eventId }); } catch (e) {}
  }
  fetch('/api/track-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'lead',
      variant: variant,
      device: device,
      name:  fullName,
      email: p.get('email'),
      phone: p.get('phone'),
      event_id: eventId,
      utms: {
        utm_source:   p.get('utm_source')   || sessionStorage.getItem('ldr_utm_source'),
        utm_medium:   p.get('utm_medium')   || sessionStorage.getItem('ldr_utm_medium'),
        utm_campaign: p.get('utm_campaign') || sessionStorage.getItem('ldr_utm_campaign'),
        utm_content:  p.get('utm_content')  || sessionStorage.getItem('ldr_utm_content'),
        utm_term:     p.get('utm_term')     || sessionStorage.getItem('ldr_utm_term'),
        gclid:        p.get('gclid')        || sessionStorage.getItem('ldr_gclid'),
        campaign_id:  p.get('campaignid')   || sessionStorage.getItem('ldr_campaignid'),
        ad_group_id:  p.get('adgroupid')    || sessionStorage.getItem('ldr_adgroupid'),
        keyword:      p.get('keyword')      || sessionStorage.getItem('ldr_keyword'),
        match_type:   p.get('matchtype')    || sessionStorage.getItem('ldr_matchtype'),
        network:      p.get('network')      || sessionStorage.getItem('ldr_network')
      }
    })
  }).catch(function(){});
})();
</` + `script>`;
        html = html.replace('</body>', leadScript + '\n</body>');
      }
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Reports page: Basic Auth gate ─────────────────────────────────────────
    if (p === '/reports' || p === '/reports/') {
      const auth = request.headers.get('Authorization') || '';
      const valid = auth.startsWith('Basic ') && (() => {
        try {
          const decoded = atob(auth.slice(6));
          const colon = decoded.indexOf(':');
          return colon > 0 && decoded.slice(0, colon) === env.REPORTS_USER && decoded.slice(colon + 1) === env.REPORTS_PASS;
        } catch { return false; }
      })();
      if (!valid) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Reports"' },
        });
      }
      const asset = await env.ASSETS.fetch(new URL('/reports.html', request.url).toString());
      let html = await asset.text();
      html = html
        .replace(/__PROJECT_NAME__/g,    env.PROJECT_NAME     || 'Dashboard')
        .replace(/__PROJECT_SUBTITLE__/g, new URL(request.url).host + ' — ' + (env.PROJECT_NAME || 'Lander'))
        .replace(/__PROJECT_SLUG__/g,    env.PROJECT_SLUG     || 'project')
        .replace(/__REPORTS_TOKEN__/g,   env.REPORTS_TOKEN    || 'CHANGE_ME')
        .replace(/__VARIANT_A_URL__/g,   env.VARIANT_A_URL    || '/')
        .replace(/__VARIANT_B_URL__/g,   env.VARIANT_B_URL    || '/b');
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── A/B split for root ────────────────────────────────────────────────────
    if (p === '/' || p === '') {
      const cookie  = request.headers.get('Cookie') || '';
      let variant   = getCookie(cookie, 'ab_variant');
      let isNew     = false;

      if (!['a', 'b'].includes(variant)) {
        variant = Math.random() < 0.5 ? 'a' : 'b';
        isNew = true;
      }

      if (isNew && env.DB && !isBot(request)) {
        const ua     = request.headers.get('User-Agent') || '';
        const device = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop';
        const utms   = extractUtms(url);
        // waitUntil keeps the worker alive until the write lands — without it the
        // pageview INSERT is cancelled when the response returns (intermittent loss).
        ctx.waitUntil(
          getCurrentRound(env)
            .then(round => trackEvent(env, round, variant, 'pageview', utms, { device }))
            .catch(() => {})
        );
      }

      const variantUrl = new URL(url);
      variantUrl.pathname = `/index-${variant}.html`;
      const asset = await env.ASSETS.fetch(variantUrl.toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      const headers = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      if (isNew) headers.set('Set-Cookie', `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(html, { headers });
    }

    // ── /a: always serve Variant A directly (for review/testing) ─────────────
    if (p === '/a' || p === '/a/') {
      const asset = await env.ASSETS.fetch(new URL('/index-a.html', request.url).toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── /b: always serve Variant B directly (for review/testing) ─────────────
    if (p === '/b' || p === '/b/') {
      const asset = await env.ASSETS.fetch(new URL('/index-b.html', request.url).toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Everything else: static assets ───────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
