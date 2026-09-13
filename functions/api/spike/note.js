// PR1 冒烟端点：GET/POST /api/spike/note
// 仅用于验证 Pages Functions + D1 绑定的读写链路；正式 API（鉴权、业务表、
// 统一错误码）在后续 PR 重新设计，届时本文件与 spike_notes 表一并删除。
//
// 防护约定（review 反馈，P1）：
//   1) 请求必须携带 x-spike-token 且等于 env.SPIKE_TOKEN。
//      secret 通过 `wrangler pages secret put SPIKE_TOKEN --project-name fluxledger`
//      注入远端，本地放 .dev.vars（已 gitignore）。未配置时端点整体关闭（404），
//      生产环境不暴露。
//   2) note 长度上限 512 字符；
//   3) 存储上限：spike_notes 超过 200 行后 POST 返回 429，防止 D1 被刷爆。

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_NOTE_LENGTH = 512;
const MAX_ROWS = 200;

function json(data, status = 200) {
	return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// 返回 null 表示放行，否则为需要直接返回的拒绝响应
function authorize(env, request) {
	const expected = env.SPIKE_TOKEN;
	if (!expected) {
		return json({ error: 'spike endpoint is disabled' }, 404);
	}
	const provided = request.headers.get('x-spike-token');
	if (provided !== expected) {
		return json({ error: 'unauthorized' }, 401);
	}
	return null;
}

export async function onRequestPost({ env, request }) {
	const denied = authorize(env, request);
	if (denied) return denied;

	let note = '';
	try {
		const body = await request.json();
		if (typeof body?.note === 'string') {
			note = body.note;
		}
	} catch {
		// 请求体不是合法 JSON，按缺少 note 处理
	}
	note = note.trim();
	if (!note) {
		return json({ error: 'note is required' }, 400);
	}
	if (note.length > MAX_NOTE_LENGTH) {
		return json({ error: `note must be <= ${MAX_NOTE_LENGTH} characters` }, 413);
	}

	const { total } = await env.DB.prepare(
		'SELECT COUNT(*) AS total FROM spike_notes',
	).first();
	if (total >= MAX_ROWS) {
		return json({ error: 'spike storage cap reached' }, 429);
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
	return json(row, 201);
}

export async function onRequestGet({ env, request }) {
	const denied = authorize(env, request);
	if (denied) return denied;

	const { results } = await env.DB.prepare(
		'SELECT id, note, created_at FROM spike_notes ORDER BY created_at DESC, id DESC LIMIT 50',
	).all();
	return json(results ?? []);
}
