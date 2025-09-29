export async function onRequestGet(context) {
  try {
    const { DB } = context.env;
    const result = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response("DB error: " + e.message, { status: 500 });
    
  }
}
