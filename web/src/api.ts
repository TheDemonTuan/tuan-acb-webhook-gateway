export const apiErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  let message = `Máy chủ trả về lỗi HTTP ${response.status}. Vui lòng thử lại.`;
  if (!contentType.includes('application/json')) return message;
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error.trim();
  } catch {
    // Use the bounded HTTP status message.
  }
  return message;
};
