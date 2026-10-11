import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchBlob } from './api';

/**
 * Imagen protegida del backend (foto de producto o QR). `<img src>` no manda
 * `Authorization`, así que se baja con fetch y se muestra como object URL.
 * `version` cambia cuando se reemplaza la foto, para no quedarse con la vieja.
 */
export function useProtectedImage(path: string | null, version: string | number = 0): string | null {
  const { data: blob } = useQuery({
    queryKey: ['image', path, version],
    queryFn: ({ signal }) => fetchBlob(path as string, signal),
    enabled: path !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Lee un archivo como base64 sin el prefijo `data:...;base64,`. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
