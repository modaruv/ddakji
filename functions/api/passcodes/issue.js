export const onRequestPost = async ({ env, request }) => {
  const db = env.DB;

  const verbs = ['flying','dancing','sneaky','roaring','dashing','clever','mighty','swift',
                 'silent','sparkling','wild','brave','cosmic','arcane','stormy','lucky','shadow','electric'];
  const animals = ['fox','otter','kraken','wolf','tiger','owl','falcon','panther','shark',
                   'dragon','lynx','bear','eagle','viper','phoenix','rhino','orca','mamba','hawk'];

  function gen() {
    const v = verbs[Math.floor(Math.random()*verbs.length)];
    const a = animals[Math.floor(Math.random()*animals.length)];
    return `the${v}${a}`;
  }

  for (let i=0; i<20; i++) {
    const code = gen();
    try {
      await db.prepare(
        'INSERT INTO passcodes (code, status, note) VALUES (?,"issued","via /issue")'
      ).bind(code).run();
      return json({ ok: true, code }, 200);
    } catch (e) {
      if (!String(e).includes('UNIQUE')) {
        return json({ ok:false, error:'db_error', details:String(e) }, 500);
      }
    }
  }
  return json({ ok:false, error:'exhausted' }, 500);
};

function json(payload, status=200) {
  return new Response(JSON.stringify(payload), {
    status, headers:{'content-type':'application/json; charset=utf-8'}
  });
}
