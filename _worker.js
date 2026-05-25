
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

async function trackEvent(env, variant, eventType, utms = {}, extra = {}) {
  await env.DB.prepare(
    `INSERT INTO events (variant, event_type, device, lead_name, lead_email, lead_phone,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, campaign_id, ad_group_id, keyword, match_type, network)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    variant, eventType,
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const p   = url.pathname;

    // ── API routes ────────────────────────────────────────────────────────────
    if (p === '/api/track-event' && request.method === 'POST') {
      if (!env.DB) return json({ ok: false }, 500);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const { event_type, variant, device, name, email, phone, utms = {} } = body;
      if (!['pageview','lead','call'].includes(event_type)) return json({ error: 'invalid event' }, 400);
      if (!['a','b'].includes(variant)) return json({ error: 'invalid variant' }, 400);
      await trackEvent(env, variant, event_type, {
        utm_source: utms.utm_source || null, utm_medium: utms.utm_medium || null,
        utm_campaign: utms.utm_campaign || null, utm_content: utms.utm_content || null,
        utm_term: utms.utm_term || null, gclid: utms.gclid || null,
        campaign_id: utms.campaign_id || null, ad_group_id: utms.ad_group_id || null,
        keyword: utms.keyword || null, match_type: utms.match_type || null,
        network: utms.network || null,
      }, { device, lead_name: name, lead_email: email, lead_phone: phone }).catch(() => {});
      return json({ ok: true });
    }

    if (p === '/api/ab-stats') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      const s = url.searchParams.get('start'), e = url.searchParams.get('end');
      const hasRange = s && e;
      const archWhere = '(archived IS NULL OR archived = 0)';
      const dateFilter = hasRange ? `WHERE ${archWhere} AND created_at >= ? AND created_at <= ?` : `WHERE ${archWhere}`;
      const binds = hasRange ? [s + ' 00:00:00', e + ' 23:59:59'] : [];
      const [stats, devices, recent, audit] = await Promise.all([
        env.DB.prepare(`SELECT variant, event_type, COUNT(*) as count FROM events ${dateFilter} GROUP BY variant, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT device, event_type, COUNT(*) as count FROM events ${dateFilter} GROUP BY device, event_type`).bind(...binds).all(),
        env.DB.prepare(`SELECT id, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, created_at FROM events ${dateFilter} ORDER BY id DESC LIMIT 200`).bind(...binds).all(),
        env.DB.prepare(`SELECT id, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 100`).all(),
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
      const buildDevice = d => {
        const s = devCounts[d] || { pageview: 0, lead: 0, call: 0 };
        return { views: s.pageview, leads: s.lead, calls: s.call, lead_cvr: s.pageview > 0 ? +((s.lead / s.pageview) * 100).toFixed(1) : 0 };
      };
      const variantData = {};
      let totalViews = 0, totalLeads = 0, totalCalls = 0;
      for (const v of variants) {
        const c = counts[v];
        variantData[v] = { views: c.pageview, leads: c.lead, calls: c.call, lead_cvr: c.pageview > 0 ? +((c.lead / c.pageview) * 100).toFixed(1) : 0 };
        totalViews += c.pageview; totalLeads += c.lead; totalCalls += c.call;
      }
      return json({ variants: variantData, total: { views: totalViews, leads: totalLeads, calls: totalCalls }, devices: { mobile: buildDevice('mobile'), desktop: buildDevice('desktop') }, events: recent.results, audit_log: audit.results, updated_at: new Date().toISOString() });
    }

    if (p === '/api/all-leads') {
      if (url.searchParams.get('token') !== env.REPORTS_TOKEN) return json({ error: 'Unauthorized' }, 401);
      if (!env.DB) return json({ error: 'DB not configured' }, 500);
      const s = url.searchParams.get('start'), e = url.searchParams.get('end');
      const hasRange = s && e;
      const dateFilter = hasRange ? "WHERE event_type = 'lead' AND created_at >= ? AND created_at <= ?" : "WHERE event_type = 'lead'";
      const binds = hasRange ? [s + ' 00:00:00', e + ' 23:59:59'] : [];
      const result = await env.DB.prepare(`SELECT id, variant, event_type, device, lead_name, lead_email, lead_phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, campaign_id, ad_group_id, keyword, match_type, network, created_at FROM events ${dateFilter} ORDER BY id DESC LIMIT 1000`).bind(...binds).all();
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
  var m = document.cookie.match(/(?:^|;\\s*)ab_variant=([^;]+)/);
  var variant = (m && ['a','b'].includes(m[1])) ? m[1] : 'a';
  var p = new URLSearchParams(window.location.search);
  var device = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  var fullName  = p.get('name') || null;
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
        .replace(/__VARIANT_A_LABEL__/g, env.VARIANT_A_LABEL  || 'Variant A')
        .replace(/__VARIANT_A_URL__/g,   env.VARIANT_A_URL    || '/')
        .replace(/__VARIANT_B_LABEL__/g, env.VARIANT_B_LABEL  || 'Variant B')
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
        trackEvent(env, variant, 'pageview', extractUtms(url), { device }).catch(() => {});
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
