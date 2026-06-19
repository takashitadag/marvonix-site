function json(res, status, data){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function normalizeSupabaseUrl(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  try{
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  }catch{
    return raw.replace(/\/rest\/v1.*$/i, '').replace(/\/$/, '');
  }
}

function getEnv(){
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if(!url || !key) throw new Error('Chybí SUPABASE_URL nebo SUPABASE_SECRET_KEY.');
  return { url, key, password };
}

function getHeader(req, name){
  const wanted = String(name).toLowerCase();
  for(const key of Object.keys(req.headers || {})){
    if(String(key).toLowerCase() === wanted) return req.headers[key];
  }
  return '';
}

function normalizePassword(value){
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function getBody(req){
  if(!req.body) return {};
  if(typeof req.body === 'string'){
    try{ return JSON.parse(req.body); }catch{ return {}; }
  }
  return req.body;
}

function isAuthorized(req, adminPassword){
  const expected = normalizePassword(adminPassword);
  if(!expected) return false;
  const headerPassword = normalizePassword(getHeader(req, 'x-admin-password'));
  if(headerPassword && headerPassword === expected) return true;
  const bodyPassword = normalizePassword(getBody(req).password);
  return Boolean(bodyPassword && bodyPassword === expected);
}

function hasAdminAttempt(req){
  return Boolean(normalizePassword(getHeader(req, 'x-admin-password')) || String(req.query?.admin || '') === '1');
}

async function supabaseRequest(path, options = {}){
  const { url, key } = getEnv();
  const endpoint = `${url}/rest/v1/${String(path).replace(/^\/+/, '')}`;
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || '',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }
  if(!response.ok){
    const message = typeof data === 'object' && data?.message ? data.message : `Supabase chyba ${response.status}`;
    throw new Error(`${message} (${response.status})`);
  }
  return data;
}

const allowedTypes = new Set(['team','references','audit_references']);
function cleanText(value, max = 5000){ return String(value ?? '').trim().slice(0, max); }
function cleanBool(value){ return value === true || value === 'true' || value === 1 || value === '1'; }

function normalizeItem(input = {}){
  const type = allowedTypes.has(input.type) ? input.type : 'references';
  return {
    type,
    title: cleanText(input.title, 180),
    subtitle: cleanText(input.subtitle, 240),
    role: cleanText(input.role, 120),
    body: cleanText(input.body, 5000),
    tag: cleanText(input.tag, 120),
    score: input.score === '' || input.score === null || input.score === undefined ? null : Number(input.score),
    image_url: cleanText(input.image_url, 500),
    external_url: cleanText(input.external_url, 500),
    visible: input.visible === undefined ? true : cleanBool(input.visible),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    updated_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res){
  try{
    const { password } = getEnv();

    if(req.method === 'GET'){
      const type = String(req.query?.type || '').trim();
      if(type && !allowedTypes.has(type)) return json(res, 400, { ok:false, message:'Neplatný typ obsahu.' });
      const admin = isAuthorized(req, password);
      if(hasAdminAttempt(req) && !admin) return json(res, 401, { ok:false, message:'Neplatné heslo.' });

      const filters = [];
      if(type) filters.push(`type=eq.${encodeURIComponent(type)}`);
      if(!admin) filters.push('visible=eq.true');
      const query = `marvonix_content?select=id,type,title,subtitle,role,body,tag,score,image_url,external_url,visible,sort_order,created_at,updated_at${filters.length ? '&' + filters.join('&') : ''}&order=sort_order.asc,created_at.desc`;
      const data = await supabaseRequest(query, { method:'GET' });
      return json(res, 200, { ok:true, items:data || [] });
    }

    if(!['POST','PUT','DELETE'].includes(req.method)){
      res.setHeader('Allow', 'GET, POST, PUT, DELETE');
      return json(res, 405, { ok:false, message:'Metoda není povolena.' });
    }

    if(!isAuthorized(req, password)) return json(res, 401, { ok:false, message:'Neplatné heslo.' });
    const body = getBody(req);

    if(req.method === 'POST'){
      const item = normalizeItem(body);
      if(!item.title || !item.body) return json(res, 400, { ok:false, message:'Vyplňte název a text.' });
      const data = await supabaseRequest('marvonix_content', { method:'POST', prefer:'return=representation', body:JSON.stringify(item) });
      return json(res, 200, { ok:true, item:data?.[0] || null });
    }

    if(req.method === 'PUT'){
      const id = cleanText(body.id, 80);
      if(!id) return json(res, 400, { ok:false, message:'Chybí ID.' });
      const item = normalizeItem(body);
      if(!item.title || !item.body) return json(res, 400, { ok:false, message:'Vyplňte název a text.' });
      const data = await supabaseRequest(`marvonix_content?id=eq.${encodeURIComponent(id)}`, { method:'PATCH', prefer:'return=representation', body:JSON.stringify(item) });
      return json(res, 200, { ok:true, item:data?.[0] || null });
    }

    if(req.method === 'DELETE'){
      const id = cleanText(body.id || req.query?.id, 80);
      if(!id) return json(res, 400, { ok:false, message:'Chybí ID.' });
      await supabaseRequest(`marvonix_content?id=eq.${encodeURIComponent(id)}`, { method:'DELETE' });
      return json(res, 200, { ok:true });
    }
  }catch(error){
    return json(res, 500, { ok:false, message:'Obsah se nepodařilo zpracovat.', detail:error.message });
  }
};
