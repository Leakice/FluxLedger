import VueShell from "./vue-shell";

// 静态壳即可：登录态由客户端 /api/whoami 获取，页面本身不读身份头。
export default function Page() {
  return <VueShell />;
}
