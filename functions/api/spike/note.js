// PR1 冒烟端点：GET/POST /api/spike/note
// 仅用于验证 Pages Functions + D1 绑定的读写链路，代码允许粗糙；
// 正式 API（鉴权、业务表、错误码）在后续 PR 重新设计。

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export async function onRequestPost({ env, request }) {
	let note = '';
	try {
		const body = await request.json();
		if (typeof body?.note === 'string') {
			note = body.note;
		}
	} catch {
		// 请求体不是合法 JSON，按缺少 note 处理
	}
	if (!note) {
		return new Response(JSON.stringify({ error: 'note is required' }), {
			status: 400,
			headers: JSON_HEADERS,
		});
	}
	const id = crypto.randomUUID();
	await env.DB.prepare('INSERT INTO spike_notes (id, note) VALUES (?1, ?2)')
		.bind(id, note)
		.run();
	const row = await env.DB.prepare(
		'SELECT id, note, created_at FROM spike_notes WHERE id = ?1',
	)
		.bind(id)
		.first();
	return new Response(JSON.stringify(row), { status: 201, headers: JSON_HEADERS });
}

export async function onRequestGet({ env }) {
	const { results } = await env.DB.prepare(
		'SELECT id, note, created_at FROM spike_notes ORDER BY created_at DESC, id DESC LIMIT 50',
	).all();
	return new Response(JSON.stringify(results ?? []), { headers: JSON_HEADERS });
}
