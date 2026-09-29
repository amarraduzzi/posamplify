import { supabase } from './supabase';

/** Resizes a photo in the browser (max width, WebP/JPEG) so menus load fast on 4G. */
async function shrink(file: File, maxW: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const webp = await new Promise<Blob | null>(r => c.toBlob(r, 'image/webp', 0.82));
    if (webp && webp.type === 'image/webp') return webp;
    return await new Promise<Blob>((r, j) => c.toBlob(b => (b ? r(b) : j(new Error('image'))), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadImage(restaurantId: string, folder: string, file: File, maxW = 1200): Promise<string> {
  const blob = await shrink(file, maxW);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${restaurantId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('menu-images').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(`Envoi de la photo impossible : ${error.message}`);
  return supabase.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
}
