export const onRequestPost = async ({ env, request }) => {
  const db = env.DB;

  // ---- 1) Gate by session cookie (same as before)
  const cookie = request.headers.get('Cookie') || '';
  const token = readCookie(cookie, 'kraken_session');
  if (!token) return json({ ok:false, error:'no_session' }, 401);

  const nowIso = new Date().toISOString();
  const sess = await db.prepare(`
    SELECT token, code, used, expires_at
    FROM claim_sessions
    WHERE token = ? LIMIT 1
  `).bind(token).first();

  if (!sess)                    return json({ ok:false, error:'bad_session' }, 401);
  if (sess.used)                return json({ ok:false, error:'session_used' }, 401);
  if (sess.expires_at <= nowIso) return json({ ok:false, error:'session_expired' }, 401);

  // ---- 2) Read & validate body (new fields)
  let b; try { b = await request.json(); } catch { b = {}; }

  // required
  const full_name   = String(b.full_name || '').trim();
  const genderRaw   = String(b.gender || '').toLowerCase().trim();
  const age         = Number.parseInt(b.age, 10);
  const phone       = String(b.phone || '').trim();
  const profile_url = String(b.profile_url || '').trim();
  const health_notes= String(b.health_notes || '').trim();
  const agree_rules   = !!b.agree_rules;
  const agree_contact = !!b.agree_contact;

  // optional
  const email = (b.email && String(b.email).trim()) || null;

  // normalize + basic checks
  const gender = ['male','female','prefer_not_to_say'].includes(genderRaw)
    ? genderRaw : null;

  const errors = {};
  if (!full_name) errors.full_name = 'required';
  if (!gender)    errors.gender    = 'invalid';
  if (!Number.isInteger(age) || age < 13 || age > 65) errors.age = 'invalid';
  if (!phone)     errors.phone     = 'required';
  if (!/^https?:\/\//i.test(profile_url)) errors.profile_url = 'invalid_url';
  if (!health_notes) errors.health_notes = 'required';
  if (!agree_rules)  errors.agree_rules  = 'must_accept';
  // email optional, but if present do a light check
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'invalid';

  if (Object.keys(errors).length) return json({ ok:false, error:'validation', fields:errors }, 400);

  // ---- 3) Write: insert registration + mark session used (+ mark passcode used)
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO registrations
          (passcode, full_name, gender, age, phone, email,
           profile_url, health_notes, agree_rules, agree_contact, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sess.code, full_name, gender, age, phone, email,
        profile_url, health_notes, agree_rules ? 1 : 0, agree_contact ? 1 : 0, nowIso
      ),

      // mark this claim session consumed (your existing behavior)
      db.prepare(`UPDATE claim_sessions SET used = 1 WHERE token = ?`).bind(token),

      // defensively mark the passcode as used as well
      db.prepare(`UPDATE passcodes SET used = 1, used_at = ? WHERE code = ?`).bind(nowIso, sess.code)
    ]);
  } catch (e) {
    // UNIQUE(passcode) or double-submit etc.
    return json({ ok:false, error:'db_error', detail:String(e.message || e) }, 500);
  }

  // ---- 4) Clear the session cookie; front-end can show "success" & reset to gate
  const headers = new Headers({'content-type':'application/json; charset=utf-8'});
  headers.append('set-cookie', 'kraken_session=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly');

  return new Response(JSON.stringify({ ok:true }), { status:200, headers });
};

function json(payload, status=200){
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8' }
  });
}
function readCookie(c, name){
  const m = c.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
