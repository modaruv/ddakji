export const onRequestPost = async ({ env, request }) => {
  const db = env.DB;
  const cookie = request.headers.get('Cookie') || '';
  const token = readCookie(cookie, 'kraken_session');
  if (!token) return json({ ok:false, error:'no_session' }, 401);

  const nowIso = new Date().toISOString();
  const sess = await db.prepare(`
    SELECT token, code, used, expires_at
    FROM claim_sessions
    WHERE token=? LIMIT 1
  `).bind(token).first();

  if (!sess) return json({ ok:false, error:'bad_session' }, 401);
  if (sess.used) return json({ ok:false, error:'session_used' }, 401);
  if (sess.expires_at <= nowIso) return json({ ok:false, error:'session_expired' }, 401);

  let body; try { body = await request.json(); } catch { body = {}; }
  const name  = String(body.name  || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const extra = body.extra ? JSON.stringify(body.extra) : null;
  if (!name || !email) return json({ ok:false, error:'missing_fields' }, 400);

  await db.batch([
    db.prepare('INSERT INTO registrations (code, name, email, phone, extra) VALUES (?, ?, ?, ?, ?)')
      .bind(sess.code, name, email, phone, extra),
    db.prepare('UPDATE claim_sessions SET used=1 WHERE token=?').bind(token)
  ]);

  const headers = new Headers({'content-type':'application/json; charset=utf-8'});
  headers.append('set-cookie', 'kraken_session=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly');
  return new Response(JSON.stringify({ ok:true }), { status:200, headers });
};

function json(p,s=200){ return new Response(JSON.stringify(p),{status:s,headers:{'content-type':'application/json; charset=utf-8'}}); }
function readCookie(c,name){ const m=c.match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return m?decodeURIComponent(m[1]):null; }
