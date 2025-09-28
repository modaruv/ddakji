export const onRequestPost = async ({ env, request }) => {
  const db = env.DB;
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const code = String(body.code || '').trim().toLowerCase();
  if (!code) return json({ ok:false, error:'missing_code' }, 400);

  const row = await db.prepare(
    'SELECT code FROM passcodes WHERE code=? AND status="issued" LIMIT 1'
  ).bind(code).first();

  if (!row) return json({ ok:false, error:'invalid_or_used' }, 400);

  const now = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  await db.batch([
    db.prepare('UPDATE passcodes SET status="used", used_at=?, used_ip=? WHERE code=? AND status="issued"')
      .bind(now, ip, code)
  ]);

  const token = randToken();
  const exp = new Date(Date.now() + 30*60*1000).toISOString();
  await db.prepare(
    'INSERT INTO claim_sessions (token, code, expires_at) VALUES (?, ?, ?)'
  ).bind(token, code, exp).run();

  const headers = new Headers({'content-type':'application/json; charset=utf-8'});
  headers.append('set-cookie', cookie('kraken_session', token, { httpOnly:true, secure:true, sameSite:'Lax', path:'/', maxAge:1800 }));
  return new Response(JSON.stringify({ ok:true }), { status:200, headers });
};

function json(p,s=200){ return new Response(JSON.stringify(p),{status:s,headers:{'content-type':'application/json; charset=utf-8'}}); }
function randToken(){ const b=new Uint8Array(24); crypto.getRandomValues(b); return [...b].map(n=>n.toString(16).padStart(2,'0')).join(''); }
function cookie(name,val,o={}){ let c=`${name}=${val}; Path=${o.path||'/'}; SameSite=${o.sameSite||'Lax'}`; if(o.httpOnly)c+='; HttpOnly'; if(o.secure)c+='; Secure'; if(o.maxAge)c+=`; Max-Age=${o.maxAge}`; return c; }
