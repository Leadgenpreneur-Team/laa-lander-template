
const BOT_UA = /facebookexternalhit|facebookcatalog|Facebot|Googlebot|Google-InspectionTool|AdsBot-Google|bingbot|YandexBot|Baiduspider|DuckDuckBot|Slurp|LinkedInBot|Twitterbot|Applebot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|GPTBot|ClaudeBot|anthropic-ai|Meta-ExternalAgent|Meta-ExternalFetcher|ia_archiver|archive\.org_bot/i;

const UTM_SAVE_SCRIPT = `<script>
(function(){
  var p=new URLSearchParams(window.location.search);
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','campaignid','adgroupid','keyword','matchtype','network','fbclid'].forEach(function(k){var v=p.get(k);if(v)sessionStorage.setItem('ldr_'+k,v);});
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
        network:sessionStorage.getItem('ldr_network'),
        fbclid:sessionStorage.getItem('ldr_fbclid')
      }
    })}).catch(function(){});
  });
})();
</` + `script>`;

// Client-side pageview beacon. Counts a visit only when a REAL browser executes JS
// (kills the majority of bots, which never run it) and the page is actually visible
// (skips prerender/prefetch). Fires once — on dwell OR on the visitor leaving early,
// whichever comes first — so fast bounces still count but a single view never double-counts.
// The per-visitor ldr_vid cookie rides along on the same-origin fetch → server stamps visitor_id.
const PAGEVIEW_TRACK_SCRIPT = `<script data-ldr-pv>
(function(){
  if(navigator.webdriver)return;
  if(document.visibilityState==='prerender')return;
  var fired=false,seen=false;
  function fire(){
    if(fired||!seen)return; fired=true;
    var m=document.cookie.match(/(?:^|;\\s*)ab_variant=([^;]+)/);
    var variant=(m&&['a','b'].includes(m[1]))?m[1]:'a';
    var device=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)?'mobile':'desktop';
    fetch('/api/track-event',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({
      event_type:'pageview',variant:variant,device:device,
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
        network:sessionStorage.getItem('ldr_network'),
        fbclid:sessionStorage.getItem('ldr_fbclid')
      }
    })}).catch(function(){});
  }
  function arm(){if(document.visibilityState==='visible'&&!seen){seen=true;setTimeout(fire,1500);}}
  arm();
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')arm();else fire();});
  window.addEventListener('pagehide',fire);
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
    fbclid:       url.searchParams.get('fbclid')       || null,
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
    `INSERT INTO events (round, variant, event_type, device, visitor_id, lead_name, lead_email, lead_phone,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, campaign_id, ad_group_id, keyword, match_type, network, fbclid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    round, variant, eventType,
    extra.device     || null,
    extra.visitor_id || null,
    extra.lead_name  || null,
    extra.lead_email || null,
    extra.lead_phone || null,
    utms.utm_source   || null, utms.utm_medium   || null,
    utms.utm_campaign || null, utms.utm_content  || null,
    utms.utm_term     || null,
    utms.gclid        || null, utms.campaign_id  || null,
    utms.ad_group_id  || null, utms.keyword      || null,
    utms.match_type   || null, utms.network      || null,
    utms.fbclid       || null
  ).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p   = url.pathname;

    // ── Internal files: never serve ───────────────────────────────────────────
    // `wrangler pages deploy .` uploads the whole repo folder, so README.md, wrangler.toml,
    // schema.sql, migrations/, .moat/, CLAUDE.md etc. would otherwise be public at
    // https://<domain>/<file>. Nothing a visitor needs uses these extensions or folders.
    let lp;
    try { lp = decodeURIComponent(p).toLowerCase(); } catch { lp = p.toLowerCase(); }
    if (/\.(md|sql|toml|jsonl|env|log|sh|py)$/.test(lp) ||
        /^\/(migrations|\.moat|\.claude|\.git|\.wrangler|node_modules)(\/|$)/.test(lp) ||
        /\/\.env/.test(lp)) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    // ── API routes ────────────────────────────────────────────────────────────
    if (p === '/api/track-event' && request.method === 'POST') {
      if (!env.DB) return json({ ok: false }, 500);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const { event_type, variant, device, name, email, phone, utms = {}, event_id } = body;
      if (!['pageview','lead','call'].includes(event_type)) return json({ error: 'invalid event' }, 400);
      if (!['a','b'].includes(variant)) return json({ error: 'invalid variant' }, 400);
      // Bot guard: known-bot UAs never count as a pageview, even if they somehow run the beacon.
      if (event_type === 'pageview' && isBot(request)) return json({ ok: true });
      // QA guard: team test visits carry the ldr_qa cookie (set by ?qa=1 on any page, e.g. the
      // dashboard's /a?qa=1 and /b?qa=1 preview links). Never logged — keeps our own hits out of
      // the data entirely, no IP tracking needed. Returns ok so the beacon sees a clean response.
      if (getCookie(request.headers.get('Cookie') || '', 'ldr_qa')) return json({ ok: true, qa: true });
      const vid = getCookie(request.headers.get('Cookie') || '', 'ldr_vid') || null;
      const round = await getCurrentRound(env);
      await trackEvent(env, round, variant, event_type, {
        utm_source: utms.utm_source || null, utm_medium: utms.utm_medium || null,
        utm_campaign: utms.utm_campaign || null, utm_content: utms.utm_content || null,
        utm_term: utms.utm_term || null, gclid: utms.gclid || null,
        campaign_id: utms.campaign_id || null, ad_group_id: utms.ad_group_id || null,
        keyword: utms.keyword || null, match_type: utms.match_type || null,
        network: utms.network || null, fbclid: utms.fbclid || null,
      }, { device, visitor_id: vid, lead_name: name, lead_email: email, lead_phone: phone }).catch(() => {});

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
          'SELECT round_number, variant_a_label, variant_b_label, started_at, launched_at, paused_at, paused_seconds FROM rounds ORDER BY round_number'
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
      // "Attributed" = the visit carries a campaign key: a utm_source, a Google gclid, or a
      // Facebook fbclid. On ads-only landers everything else is bot/QA/leak noise. The headline
      // Unique Visitors and the blended CVR denominator count attributed visits only; the
      // unattributed count is surfaced separately as a data-quality diagnostic, and leads/calls
      // are NEVER filtered by this (a real conversion counts even if its click id got stripped).
      const ATTR = `((utm_source IS NOT NULL AND utm_source != '') OR (gclid IS NOT NULL AND gclid != '') OR (fbclid IS NOT NULL AND fbclid != ''))`;

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

      const [stats, devices, variantDevices, daily, recent, audit, qcalls, bySourceQ, uniqueLeadsQ, uvByVariantQ, uvBySourceQ, uvTotalQ, uvUnattributedQ, uniqueCallsQ] = await Promise.all([
        env.DB.prepare(`SELECT variant, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY variant, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT device, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY device, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT variant, device, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY variant, device, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT DATE(created_at) as day, variant, event_type, COUNT(*) as count FROM events ${WHERE} GROUP BY day, variant, event_type ORDER BY day`).bind(...binds).all(),
        // Recent Events feed: ALL lead/call/qualified events for the round (so the lead
        // filters in the table are complete, not a sample of the last 100 rows) PLUS the
        // 100 most-recent pageviews to keep the payload bounded. See reports.html filters.
        env.DB.prepare(`SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, fbclid, created_at FROM (
          SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, fbclid, created_at FROM events ${WHERE} AND event_type != 'pageview'
          UNION ALL
          SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, fbclid, created_at FROM (
            SELECT * FROM events ${WHERE} AND event_type = 'pageview' ORDER BY id DESC LIMIT 100
          )
        ) ORDER BY id DESC`).bind(...binds, ...binds).all(),
        env.DB.prepare(`SELECT id, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 100`).all(),
        env.DB.prepare(`SELECT COUNT(*) as count FROM events ${WHERE} AND event_type = 'qualified_call'`).bind(...binds).all(),
        // Traffic bucketed by acquisition source (Tier 1 accuracy: judge each channel on its own numbers).
        // fbclid folds into facebook so FB clicks that arrive with only an fbclid (no manual utm_source)
        // stop leaking into direct/untagged.
        env.DB.prepare(`SELECT CASE
            WHEN utm_source IN ('fb_ads','fb') OR (fbclid IS NOT NULL AND fbclid != '') THEN 'facebook'
            WHEN utm_source = 'google' OR utm_source LIKE 'goog%' OR (gclid IS NOT NULL AND gclid != '') THEN 'google'
            WHEN utm_source IS NULL OR utm_source = '' THEN 'direct/untagged'
            ELSE utm_source END AS source, event_type, COUNT(*) as count
          FROM events ${WHERE} GROUP BY source, event_type`).bind(...binds).all(),
        // Unique leads: dedup by normalized phone, then email; anonymous leads count once each (row id fallback)
        env.DB.prepare(`SELECT COUNT(DISTINCT COALESCE(
            NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(lead_phone,'(',''),')',''),'-',''),' ',''), ''),
            LOWER(TRIM(lead_email)),
            'row' || id
          )) as unique_leads FROM events ${WHERE} AND event_type = 'lead'`).bind(...binds).all(),
        // Unique visitors, ATTRIBUTED ONLY (Tier 2 + attribution): distinct visitor_id among
        // pageviews that carry a campaign key. This is the headline per-variant visitor count.
        env.DB.prepare(`SELECT variant, COUNT(DISTINCT visitor_id) as uv FROM events ${WHERE} AND event_type = 'pageview' AND visitor_id IS NOT NULL AND ${ATTR} GROUP BY variant`).bind(...binds).all(),
        // Unique visitors by source — kept UNFILTERED (all sources incl. direct/untagged) so the
        // source table still shows the unattributed row as a visible, walled-off diagnostic.
        env.DB.prepare(`SELECT CASE
            WHEN utm_source IN ('fb_ads','fb') OR (fbclid IS NOT NULL AND fbclid != '') THEN 'facebook'
            WHEN utm_source = 'google' OR utm_source LIKE 'goog%' OR (gclid IS NOT NULL AND gclid != '') THEN 'google'
            WHEN utm_source IS NULL OR utm_source = '' THEN 'direct/untagged'
            ELSE utm_source END AS source, COUNT(DISTINCT visitor_id) as uv
          FROM events ${WHERE} AND event_type = 'pageview' AND visitor_id IS NOT NULL GROUP BY source`).bind(...binds).all(),
        // Headline total unique visitors — ATTRIBUTED ONLY.
        env.DB.prepare(`SELECT COUNT(DISTINCT visitor_id) as uv FROM events ${WHERE} AND event_type = 'pageview' AND visitor_id IS NOT NULL AND ${ATTR}`).bind(...binds).all(),
        // Diagnostic: unique visitors WITHOUT any campaign key (the excluded noise/leak pile).
        env.DB.prepare(`SELECT COUNT(DISTINCT visitor_id) as uv FROM events ${WHERE} AND event_type = 'pageview' AND visitor_id IS NOT NULL AND NOT ${ATTR}`).bind(...binds).all(),
        // Unique call clicks: dedup by visitor_id so one caller clicking twice counts once
        // (raw call rows stay in the DB for audit; only the headline is deduped).
        env.DB.prepare(`SELECT COUNT(DISTINCT visitor_id) as uc FROM events ${WHERE} AND event_type = 'call' AND visitor_id IS NOT NULL`).bind(...binds).all(),
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
      const sourceData = {};
      for (const row of bySourceQ.results) {
        const s = row.source || 'direct/untagged';
        if (!sourceData[s]) sourceData[s] = { views: 0, leads: 0, calls: 0 };
        if (row.event_type === 'pageview') sourceData[s].views += row.count;
        else if (row.event_type === 'lead') sourceData[s].leads += row.count;
        else if (row.event_type === 'call') sourceData[s].calls += row.count;
      }
      for (const s of Object.keys(sourceData)) {
        const sd = sourceData[s];
        sd.lead_cvr = sd.views > 0 ? +(((sd.leads + sd.calls) / sd.views) * 100).toFixed(1) : 0;
      }
      const uniqueLeads = (uniqueLeadsQ.results[0] && uniqueLeadsQ.results[0].unique_leads) || 0;

      // Unique visitors (distinct visitor_id) — bot-free true-unique counts (Tier 2)
      const uvByVariant = {};
      for (const r of uvByVariantQ.results) uvByVariant[r.variant] = r.uv;
      for (const v of variants) if (variantData[v]) variantData[v].unique_views = uvByVariant[v] || 0;
      for (const r of uvBySourceQ.results) { const s = r.source || 'direct/untagged'; if (sourceData[s]) sourceData[s].unique_views = r.uv || 0; }
      for (const s of Object.keys(sourceData)) if (sourceData[s].unique_views == null) sourceData[s].unique_views = 0;
      const uniqueViewsTotal   = (uvTotalQ.results[0] && uvTotalQ.results[0].uv) || 0;          // attributed only
      const unattributedViews  = (uvUnattributedQ.results[0] && uvUnattributedQ.results[0].uv) || 0;
      const uniqueCalls        = (uniqueCallsQ.results[0] && uniqueCallsQ.results[0].uc) || 0;
      // % of real unique visitors that carried a campaign key — the bot/leak health gauge.
      const attributedDen = uniqueViewsTotal + unattributedViews;
      const attributedPct = attributedDen > 0 ? +((uniqueViewsTotal / attributedDen) * 100).toFixed(0) : null;

      return json({
        rounds: roundsData,
        current_round: currentRoundNum,
        round: targetRound,
        variants: variantData,
        total: { views: totalViews, unique_views: uniqueViewsTotal, unattributed_views: unattributedViews, attributed_pct: attributedPct, leads: totalLeads, unique_leads: uniqueLeads, calls: totalCalls, unique_calls: uniqueCalls, qualified_calls: (qcalls.results[0] && qcalls.results[0].count) || 0 },
        by_source: sourceData,
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
      const result = await env.DB.prepare(`SELECT id, round, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, fbclid, created_at FROM events ${dateFilter} ORDER BY id DESC LIMIT 1000`).bind(...binds).all();
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

    // Start Round: stamp the current round's launched_at = now. The "days running" clock counts
    // from this, NOT from when the dashboard/DB was created — so a lander deployed days before the
    // client actually goes live doesn't show phantom days. Idempotent-ish: re-clicking re-stamps to
    // now (guarded by a confirm in the UI). Only affects the newest round.
    if (p === '/api/start-round' && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      const row = await env.DB.prepare('SELECT MAX(round_number) AS r FROM rounds').first();
      const r = (row && row.r != null) ? row.r : 1;
      await env.DB.prepare('UPDATE rounds SET launched_at = CURRENT_TIMESTAMP WHERE round_number = ?').bind(r).run();
      await env.DB.prepare("INSERT INTO audit_log (action, detail) VALUES ('start_round', ?)").bind(`Round ${r} started`).run();
      return json({ ok: true, round: r });
    }

    // Pause / Resume the current round. Pausing freezes the days-running clock; resuming banks the
    // paused duration into paused_seconds so it's subtracted from the total (paused days don't count
    // as running). Toggles based on current state. Only a launched round can be paused.
    if (p === '/api/toggle-round-pause' && request.method === 'POST') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      const cur = await env.DB.prepare('SELECT round_number, launched_at, paused_at FROM rounds ORDER BY round_number DESC LIMIT 1').first();
      if (!cur) return json({ error: 'no round' }, 400);
      if (!cur.launched_at) return json({ error: 'round not started' }, 400);
      let paused;
      if (cur.paused_at) {
        // Resume: bank the elapsed paused time, clear paused_at.
        await env.DB.prepare(
          "UPDATE rounds SET paused_seconds = COALESCE(paused_seconds,0) + CAST((julianday('now') - julianday(paused_at)) * 86400 AS INTEGER), paused_at = NULL WHERE round_number = ?"
        ).bind(cur.round_number).run();
        paused = false;
      } else {
        // Pause: freeze the clock now.
        await env.DB.prepare('UPDATE rounds SET paused_at = CURRENT_TIMESTAMP WHERE round_number = ?').bind(cur.round_number).run();
        paused = true;
      }
      await env.DB.prepare("INSERT INTO audit_log (action, detail) VALUES ('toggle_pause', ?)")
        .bind(`Round ${cur.round_number} ${paused ? 'paused' : 'resumed'}`).run();
      return json({ ok: true, round: cur.round_number, paused });
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
  // or touches Google Ads conversions — those are the team's gtag snippet in the
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
        network:      p.get('network')      || sessionStorage.getItem('ldr_network'),
        fbclid:       p.get('fbclid')       || sessionStorage.getItem('ldr_fbclid')
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
        .replace(/__PROJECT_SUBTITLE__/g, new URL(request.url).host)
        .replace(/__PROJECT_SLUG__/g,    env.PROJECT_SLUG     || 'project')
        .replace(/__REPORTS_TOKEN__/g,   env.REPORTS_TOKEN    || 'CHANGE_ME')
        // Variant preview links are always the dedicated /a and /b routes below,
        // which bypass the split and serve index-a.html / index-b.html directly.
        // Hardcoded (not read from env) so a misconfigured VARIANT_A_URL secret
        // can never produce a dead link on the dashboard (e.g. /?ab_variant=a).
        // ?qa=1 so clicking a preview from the dashboard tags the viewer as QA and their
        // hits never count toward the reports numbers.
        .replace(/__VARIANT_A_URL__/g,   '/a?qa=1')
        .replace(/__VARIANT_B_URL__/g,   '/b?qa=1');
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

      // Per-visitor id (1yr) for true unique-visitor counting. Pageviews are now logged by
      // the client-side beacon (PAGEVIEW_TRACK_SCRIPT), NOT server-side — so bots that never
      // execute JS no longer inflate the count. The beacon's fetch carries ldr_vid back.
      let visitorId = getCookie(cookie, 'ldr_vid');
      let needVid = false;
      if (!visitorId) { visitorId = crypto.randomUUID(); needVid = true; }

      const variantUrl = new URL(url);
      variantUrl.pathname = `/index-${variant}.html`;
      const asset = await env.ASSETS.fetch(variantUrl.toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      if (!html.includes('data-ldr-pv'))   html = html.replace('</body>', PAGEVIEW_TRACK_SCRIPT + '\n</body>');
      const headers = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      if (isNew)   headers.append('Set-Cookie', `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`);
      if (needVid) headers.append('Set-Cookie', `ldr_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`);
      // QA flag: ?qa=1 marks this browser as a team test session (30d) so its visits are never counted.
      if (url.searchParams.get('qa') === '1') headers.append('Set-Cookie', `ldr_qa=1; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(html, { headers });
    }

    // ── /b: always serve Variant A directly (for review/testing) ─────────────
    if (p === '/a' || p === '/a/') {
      const asset = await env.ASSETS.fetch(new URL('/index-a.html', request.url).toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
      if (url.searchParams.get('qa') === '1') h.append('Set-Cookie', `ldr_qa=1; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(html, { headers: h });
    }

    // ── /b: always serve Variant B directly (for review/testing) ─────────────
    if (p === '/b' || p === '/b/') {
      const asset = await env.ASSETS.fetch(new URL('/index-b.html', request.url).toString());
      let html = await asset.text();
      if (!html.includes('ldr_utm_source')) html = html.replace('</head>', UTM_SAVE_SCRIPT + '\n</head>');
      if (!html.includes('data-ldr-call')) html = html.replace('</body>', CALL_TRACK_SCRIPT + '\n</body>');
      const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
      if (url.searchParams.get('qa') === '1') h.append('Set-Cookie', `ldr_qa=1; Path=/; Max-Age=2592000; SameSite=Lax`);
      return new Response(html, { headers: h });
    }

    // ── Everything else: static assets ───────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
