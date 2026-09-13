// user id 的短哈希（FNV-1a 32 位，8 位十六进制截断）。
// 用途：云端账户在 localStorage 的缓存命名空间（cloud-cache-<uidHash>-<原 key>），
// 避免把完整 user id 明文写进存储键名。纯同步、无依赖，前端与服务端可用同一
// 实现算出一致结果；只做命名空间隔离，不是安全边界。

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function uidHash(userId) {
  const text = String(userId);
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// 账户菜单展示用的掩码：保留前 2 位与末 4 位，中间以 … 代替。
export function maskedUserId(userId) {
  const text = String(userId);
  if (text.length <= 6) return text.slice(0, 2) + '…';
  return text.slice(0, 2) + '…' + text.slice(-4);
}
