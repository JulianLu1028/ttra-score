export class AcademicRequestTimeout extends Error {
  constructor() {
    super("等候伺服器回應逾時");
    this.name = "AcademicRequestTimeout";
  }
}

// Bound the whole request, including any wait for the authentication session.
export async function academicRequest<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AcademicRequestTimeout());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function academicImportError(error: unknown): string {
  if (error instanceof AcademicRequestTimeout)
    return "尚未收到匯入結果。請先按上方「更新」確認名單是否已匯入，再決定是否重試；請勿連續送出。";
  const detail = error as { code?: string; message?: string } | null;
  if (detail?.code === "23505")
    return "匯入名單含已存在的參賽編號，整批未新增。請按上方「更新」核對現有名單後再匯入。";
  if (detail?.code === "42501")
    return "目前登入身份沒有匯入權限，請重新登入工作人員帳號後再試。";
  return "匯入未完成：" + (detail?.message || "請確認網路連線後再試。");
}
