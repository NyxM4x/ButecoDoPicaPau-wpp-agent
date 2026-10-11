import { ImageOff } from 'lucide-react';
import { useProtectedImage } from '../lib/images';
import type { Product } from '../lib/types';
import { cx } from './ui';

export function ProductImage({ product, className }: { product: Pick<Product, 'imageUrl' | 'name'>; className?: string }) {
  const src = useProtectedImage(product.imageUrl);
  return (
    <div className={cx('flex items-center justify-center overflow-hidden bg-slate-100 text-slate-300', className)}>
      {src ? <img src={src} alt={product.name} className="h-full w-full object-cover" loading="lazy" /> : <ImageOff className="h-8 w-8" />}
    </div>
  );
}
