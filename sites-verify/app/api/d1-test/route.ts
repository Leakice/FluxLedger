import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { verifyRecords } from "../../../db/schema";
import { getChatGPTUser } from "../../../app/chatgpt-auth";

// 归属由服务端认证身份决定，不信任客户端提交的 user_id。
// 未认证返回 401 JSON，不重定向。
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { authenticated: false, error: "unauthenticated" },
      { status: 401 },
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
    return Response.json({ authenticated: true, records: rows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unexpected error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { authenticated: false, error: "unauthenticated" },
      { status: 401 },
    );
  }
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      note?: string;
    };
    const note = (payload.note ?? `verify @ ${new Date().toISOString()}`).slice(
      0,
      200,
    );
    const db = getDb();
    const [row] = await db
      .insert(verifyRecords)
      .values({ userId: user.userId, note })
      .returning();
    return Response.json({ authenticated: true, record: row }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unexpected error" },
      { status: 500 },
    );
  }
}
