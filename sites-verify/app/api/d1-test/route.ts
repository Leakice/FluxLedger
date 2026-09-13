import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { verifyRecords } from "../../../db/schema";
import { getChatGPTUser } from "../../../app/chatgpt-auth";

// 含用户数据的响应一律禁止缓存；错误响应固定文案，不回传内部细节。
const NO_STORE = { "Cache-Control": "no-store" };
const INTERNAL_ERROR = { error: "internal error" };

// 归属由服务端认证身份决定，不信任客户端提交的 user_id。
// 未认证返回 401 JSON，不重定向。
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { authenticated: false, error: "unauthenticated" },
      { status: 401, headers: NO_STORE },
    );
  }
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(verifyRecords)
      .where(eq(verifyRecords.userId, user.userId))
      .orderBy(desc(verifyRecords.id))
      .limit(50);
    return Response.json({ authenticated: true, records: rows }, { headers: NO_STORE });
  } catch {
    return Response.json(INTERNAL_ERROR, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { authenticated: false, error: "unauthenticated" },
      { status: 401, headers: NO_STORE },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "request body must be valid JSON" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json(
      { error: "request body must be a JSON object" },
      { status: 400, headers: NO_STORE },
    );
  }
  const rawNote = (payload as { note?: unknown }).note;
  if (rawNote !== undefined && typeof rawNote !== "string") {
    return Response.json(
      { error: "note must be a string" },
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const note = (
      typeof rawNote === "string" && rawNote.trim()
        ? rawNote
        : `verify @ ${new Date().toISOString()}`
    ).slice(0, 200);
    const db = getDb();
    const [row] = await db
      .insert(verifyRecords)
      .values({ userId: user.userId, note })
      .returning();
    return Response.json(
      { authenticated: true, record: row },
      { status: 201, headers: NO_STORE },
    );
  } catch {
    // 固定错误响应，避免数据库错误带出 SQL 与参数；详情仅记入服务端日志。
    console.error("d1-test insert failed");
    return Response.json(INTERNAL_ERROR, { status: 500, headers: NO_STORE });
  }
}
