/** Upload an image to the admin-only upload route and return its public URL. */
export async function uploadFile(file: File, kind: 'logo' | 'image' | 'background'): Promise<string> {
  const max = kind === 'logo' ? 1 : 2;
  if (file.size > max * 1024 * 1024) throw new Error(`File is too large. Max ${max} MB.`);
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? 'Upload failed');
  return data.url as string;
}

