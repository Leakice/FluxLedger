import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../d1";
import {
  LEDGER_DOCUMENT_MAX_BYTES,
  documentByteSize,
  validateBaseVersion,
  validateLedgerDocument,
} from "../../ledger-document.js";

// 含用户数据的响应一律禁止缓存；错误响应固定文案，不回传 SQL 与内部细节。
const NO_STORE = { "Cache-Control": "no-store" };
const INTERNAL_ERROR = { error: "internal error" };

// 归属校验是第一行逻辑：身份只来自服务端认证头（getChatGPTUser），
// 客户端提交的任何 user_id 一律不采信。
async function requireUser() {
  return getChatGPTUser();
}

function unauthorized() {
  return Response.json(
    { authenticated: false, error: "unauthenticated" },
    { status: 401, headers: NO_STORE },
  );
}

async function readRow(userId: string) {
  const row = await getD1()
    .prepare("SELECT data, version FROM ledger_documents WHERE user_id = ?1")
    .bind(userId)
    .first<{ data: string; version: number }>();
  if (!row) return null;
  return { data: JSON.parse(row.data) as unknown, version: row.version as number };
}

// GET：返回 {data, version}；无记录返回 {data: null, version: 0}；未认证 401 JSON。
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  try {
    const row = await readRow(user.userId);
    if (!row) {
      return Response.json({ data: null, version: 0 }, { headers: NO_STORE });
    }
    return Response.json({ data: row.data, version: row.version }, { headers: NO_STORE });
  } catch {
    console.error("ledger read failed");
    return Response.json(INTERNAL_ERROR, { status: 500, headers: NO_STORE });
  }
}

// PUT：请求体 {data, baseVersion}。baseVersion 与库存 version 一致才写入（version+1）；
// 不一致返回 409 与当前 {currentVersion, currentData}，供客户端刷新缓存。
export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400, headers: NO_STORE });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json({ error: "request body must be an object" }, { status: 400, headers: NO_STORE });
  }
  const body = payload as { data?: unknown; baseVersion?: unknown; expectedUserId?: unknown };
  if (!validateBaseVersion(body.baseVersion)) {
    return Response.json({ error: "baseVersion must be a non-negative integer" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.expectedUserId !== "string" || !body.expectedUserId || body.expectedUserId.length > 128) {
    return Response.json({ error: "expectedUserId must be a string" }, { status: 400, headers: NO_STORE });
  }
  // 一致性检查（非归属判断）：客户端快照的账号必须与本次请求的认证身份一致，
  // 否则说明 whoami 之后、写库之前会话已切换（旧页面竞态）。归属永远只取认证头。
  if (body.expectedUserId !== user.userId) {
    return Response.json({ error: "identity mismatch" }, { status: 403, headers: NO_STORE });
  }
  if (!validateLedgerDocument(body.data)) {
    return Response.json(
      { error: "data must be an object with array fields: transactions, cards, hiddenBuiltInCardIds" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (documentByteSize(body.data) > LEDGER_DOCUMENT_MAX_BYTES) {
    return Response.json({ error: "document too large" }, { status: 413, headers: NO_STORE });
  }

  const data = JSON.stringify(body.data);
  const baseVersion = body.baseVersion as number;
  try {
    const db = getD1();
    if (baseVersion === 0) {
      // 新建：仅当该用户尚无记录时插入（version=1）。已存在即冲突。
      const result = await db
        .prepare(
          "INSERT INTO ledger_documents (user_id, data, version, updated_at) VALUES (?1, ?2, 1, datetime('now')) ON CONFLICT(user_id) DO NOTHING"
        )
        .bind(user.userId, data)
        .run();
      if (result.meta.changes === 1) {
        return Response.json({ version: 1 }, { headers: NO_STORE });
      }
    } else {
      // 更新：条件写保证乐观锁；并发下只有一个请求能改到 version=baseVersion 的行。
      const result = await db
        .prepare(
          "UPDATE ledger_documents SET data = ?2, version = version + 1, updated_at = datetime('now') WHERE user_id = ?1 AND version = ?3"
        )
        .bind(user.userId, data, baseVersion)
        .run();
      if (result.meta.changes === 1) {
        return Response.json({ version: baseVersion + 1 }, { headers: NO_STORE });
      }
    }
    // 未写入：读取当前库存返回 409（可能是他人已写入，或 baseVersion=0 但记录已存在）。
    const current = await readRow(user.userId);
    return Response.json(
      {
        error: "version conflict",
        currentVersion: current?.version ?? 0,
        currentData: current?.data ?? null,
      },
      { status: 409, headers: NO_STORE },
    );
  } catch {
    // 固定错误响应，避免数据库错误带出 SQL 与参数；详情仅记入服务端日志。
    console.error("ledger write failed");
    return Response.json(INTERNAL_ERROR, { status: 500, headers: NO_STORE });
  }
}
