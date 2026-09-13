import { getChatGPTUser } from "../../../app/chatgpt-auth";

// 未认证返回 401 JSON，绝不把 API 请求重定向到登录页。
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { authenticated: false, error: "unauthenticated" },
      { status: 401 },
    );
  }
  // 只返回身份展示所需字段；认证头本身不回传浏览器。
  return Response.json({
    authenticated: true,
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
  });
}
