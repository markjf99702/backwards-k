// A stand-in for Google sign-in and the Drive API, for testing Drive saving in Playwright without Google.
// Every browser context given the same fake shares one Drive, so two contexts are two devices.
// (From the junkdrawer kit, with what Backwards K also uses: multipart updates, appProperties that merge the way
// Drive's do, and binned files that still show up in a search that doesn't exclude them.)
//
//   const g = fakeGoogle();
//   await g.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace(…) } });
//   g.files() lists what's in the fake Drive; g.calls records every request.
//
// Sign-in: requestAccessToken() answers with the token 'tok-' + localStorage '__who' (default 'mark'), so different
// accounts are different Drives. A token of 'tok-expired' gets 401s.
const GIS = `window.google={accounts:{oauth2:{
  initTokenClient:function(cfg){window.__cfg=cfg;return{requestAccessToken:function(o){window.__prompts=(window.__prompts||[]).concat([o||{}]);setTimeout(function(){cfg.callback({access_token:'tok-'+(localStorage.getItem('__who')||'mark'),expires_in:3599,scope:cfg.scope,token_type:'Bearer'});},20);}};},
  hasGrantedAllScopes:function(r,s){return (r.scope||'').indexOf(s)>=0;},
  revoke:function(t,cb){window.__revoked=(window.__revoked||0)+1;cb&&cb();}}}};`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };

// Drive merges appProperties on update, and a null value removes a key.
function setMeta(f, meta) {
  const { appProperties, ...rest } = meta;
  Object.assign(f, rest);
  if (appProperties) {
    f.appProperties = { ...(f.appProperties || {}) };
    for (const [k, v] of Object.entries(appProperties)) if (v === null) delete f.appProperties[k]; else f.appProperties[k] = v;
  }
}
function parts(req) {
  const raw = req.postData() || '', boundary = /boundary=([^;]+)/.exec(req.headers()['content-type'] || '')[1];
  const ps = raw.split('--' + boundary).map(x => x.replace(/^\r\n/, '')).filter(x => x && !x.startsWith('--'));
  const bodyOf = x => x.slice(x.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return [JSON.parse(bodyOf(ps[0])), bodyOf(ps[1])];
}

export function fakeGoogle() {
  const drive = { files: {}, next: 1 }, calls = [];
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push(m + ' ' + p + url.search);
    const json = (o, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    const auth = (req.headers()['authorization'] || '').replace('Bearer ', '');
    if (!auth.startsWith('tok-') || auth === 'tok-expired') return json({ error: { code: 401 } }, 401);
    const owner = auth.slice(4), mine = id => drive.files[id] && drive.files[id].owner === owner ? drive.files[id] : null;
    let mm;
    if (m === 'GET' && p === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '', ap = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(q);
      const noBin = /trashed\s*=\s*false/.test(q);
      const hit = Object.entries(drive.files).filter(([, f]) => f.owner === owner && !(noBin && f.trashed) && (!ap || (f.appProperties || {})[ap[1]] === ap[2]));
      return json({ files: hit.map(([id, f]) => ({ id, name: f.name, trashed: !!f.trashed, version: String(f.version), appProperties: f.appProperties })) });
    }
    if (m === 'GET' && p === '/drive/v3/about') return json({ user: { displayName: owner, emailAddress: owner + '@gmail.com' } });
    if (m === 'POST' && p === '/drive/v3/files') { // metadata only: the folder
      const id = 'f' + drive.next++; drive.files[id] = { owner, version: 1, body: null }; setMeta(drive.files[id], JSON.parse(req.postData() || '{}'));
      return json({ id, version: '1' });
    }
    if (m === 'POST' && p === '/upload/drive/v3/files') { // uploadType=multipart
      const [meta, body] = parts(req), parent = meta.parents && meta.parents[0];
      if (parent && !mine(parent)) return json({ error: 'parent not found' }, 404);
      const id = 'f' + drive.next++; drive.files[id] = { owner, version: 1, body }; setMeta(drive.files[id], meta);
      return json({ id, version: '1' });
    }
    if ((mm = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p))) {
      const f = mine(mm[1]); if (!f) return json({ error: 'not found' }, 404);
      if (m === 'GET') return url.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: f.body || '' }) : json({ id: mm[1], name: f.name, version: String(f.version), appProperties: f.appProperties });
      if (m === 'PATCH') { setMeta(f, JSON.parse(req.postData() || '{}')); f.version++; return json({ id: mm[1], version: String(f.version) }); }
      if (m === 'DELETE') { delete drive.files[mm[1]]; return route.fulfill({ status: 204, headers: CORS }); }
    }
    if (m === 'PATCH' && (mm = /^\/upload\/drive\/v3\/files\/([\w-]+)$/.exec(p))) {
      const f = mine(mm[1]); if (!f) return json({ error: 'not found' }, 404);
      if (url.searchParams.get('uploadType') === 'multipart') { const [meta, body] = parts(req); setMeta(f, meta); f.body = body; }
      else f.body = req.postData();
      f.version++;
      return json({ id: mm[1], version: String(f.version) });
    }
    return json({ error: 'the fake Drive has no ' + m + ' ' + p }, 400);
  }
  return {
    drive, calls,
    files: () => Object.entries(drive.files).map(([id, f]) => ({ id, ...f })),
    async install(ctx, { rewrite = {} } = {}) {
      for (const [glob, fn] of Object.entries(rewrite)) {
        await ctx.route(glob, async route => { const r = await route.fetch(); route.fulfill({ response: r, body: fn(await r.text()) }); });
      }
      await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'application/javascript', body: GIS }));
      await ctx.route('https://www.googleapis.com/**', handle);
    },
  };
}
