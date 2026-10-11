import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Pencil, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Page } from '../../components/Layout';
import { ProductImage } from '../../components/ProductImage';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, Toggle, cx, toast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, fileToBase64 } from '../../lib/images';
import { byOrder, useCategories, useProducts } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { slugify } from '../../lib/text';
import type { Category, Product } from '../../lib/types';

export function MenuPage() {
  const isAdmin = useSession((state) => state.user?.role === 'admin');
  const categories = useCategories(true);
  const products = useProducts(true);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);

  const loading = categories.isPending || products.isPending;
  const failed = categories.error ?? products.error;
  const sortedCategories = byOrder(categories.data ?? []);
  const visible = sortedCategories.filter((category) => category.isActive);
  const hidden = sortedCategories.filter((category) => !category.isActive);
  const [showHidden, setShowHidden] = useState(false);

  return (
    <Page>
      <PageHeader
        title="Menú"
        subtitle={isAdmin ? 'Los cambios se ven al instante en la venta, la cocina y WhatsApp.' : 'Marca lo que se agotó para que no se pueda pedir.'}
        actions={
          isAdmin && (
            <>
              <Button variant="secondary" onClick={() => setEditingCategory('new')}>
                <Plus className="h-4 w-4" />
                Categoría
              </Button>
              <Button onClick={() => setEditing('new')} disabled={sortedCategories.length === 0}>
                <Plus className="h-4 w-4" />
                Producto
              </Button>
            </>
          )
        }
      />

      {loading && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {failed && <ErrorNote>{errorMessage(failed)}</ErrorNote>}
      {!loading && !failed && sortedCategories.length === 0 && <EmptyState title="Todavía no hay categorías">Crea una categoría para empezar a cargar productos.</EmptyState>}

      <div className="space-y-5">
        {visible.map((category) => (
          <CategorySection key={category.id} category={category} products={products.data ?? []} isAdmin={isAdmin} onEdit={setEditing} onEditCategory={setEditingCategory} />
        ))}
      </div>

      {/* Lo que apagó otra demo (o se ocultó a mano) queda abajo y plegado: sigue ahí para reactivarlo. */}
      {hidden.length > 0 && (
        <div className="mt-8">
          <button type="button" className="text-sm font-semibold text-slate-500 underline" onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? 'Ocultar categorías apagadas' : `Ver categorías apagadas (${hidden.length})`}
          </button>
          {showHidden && (
            <div className="mt-4 space-y-5">
              {hidden.map((category) => (
                <CategorySection key={category.id} category={category} products={products.data ?? []} isAdmin={isAdmin} onEdit={setEditing} onEditCategory={setEditingCategory} />
              ))}
            </div>
          )}
        </div>
      )}

      {editing && <ProductForm product={editing === 'new' ? null : editing} categories={sortedCategories} onClose={() => setEditing(null)} />}
      {editingCategory && <CategoryForm category={editingCategory === 'new' ? null : editingCategory} onClose={() => setEditingCategory(null)} />}
    </Page>
  );
}

interface CategorySectionProps {
  category: Category;
  products: Product[];
  isAdmin: boolean;
  onEdit: (product: Product) => void;
  onEditCategory: (category: Category) => void;
}

function CategorySection({ category, products, isAdmin, onEdit, onEditCategory }: CategorySectionProps) {
  const items = byOrder(products.filter((product) => product.categoryId === category.id));
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={cx('text-base font-bold', !category.isActive && 'text-slate-400 line-through')}>{category.name}</h2>
        {!category.isActive && <Badge>Oculta</Badge>}
        <span className="text-sm text-slate-400">{items.length}</span>
        {isAdmin && (
          <button type="button" aria-label={`Editar categoría ${category.name}`} onClick={() => onEditCategory(category)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
      <Card className="divide-y divide-slate-100">
        {items.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Sin productos.</p>}
        {items.map((product) => (
          <ProductRow key={`${product.id}:${product.price}`} product={product} isAdmin={isAdmin} onEdit={() => onEdit(product)} />
        ))}
      </Card>
    </section>
  );
}

function ProductRow({ product, isAdmin, onEdit }: { product: Product; isAdmin: boolean; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [price, setPrice] = useState(String(product.price));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  // La disponibilidad va por su propio endpoint y el campo se llama `available`.
  const availability = useMutation({
    mutationFn: (available: boolean) => api.patch<Product>(`/products/${product.id}/availability`, { available }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const savePrice = useMutation({
    mutationFn: (value: number) => api.patch<Product>(`/products/${product.id}`, { price: value }),
    onSuccess: (saved) => toast.ok(`${saved.name}: ${money(saved.price)}`),
    onError: (error) => {
      setPrice(String(product.price));
      toast.error(errorMessage(error));
    },
    onSettled: refresh,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!IMAGE_MIME_TYPES.includes(file.type)) throw new Error('La foto debe ser JPG, PNG o WebP.');
      if (file.size > MAX_IMAGE_BYTES) throw new Error('La foto pesa más de 5 MB.');
      return api.post<Product>(`/products/${product.id}/image`, { mimeType: file.type, fileBase64: await fileToBase64(file) });
    },
    onSuccess: (saved) => {
      toast.ok(`Foto de ${saved.name} actualizada.`);
      // La ruta de la foto no cambia al reemplazarla: hay que tirar la copia en caché.
      void queryClient.invalidateQueries({ queryKey: ['image', saved.imageUrl] });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const commitPrice = () => {
    const value = Number(price);
    if (price.trim() === '' || !Number.isFinite(value) || value < 0) return setPrice(String(product.price));
    if (value !== product.price) savePrice.mutate(value);
  };

  return (
    <div className={cx('flex flex-wrap items-center gap-3 px-4 py-2.5', !product.isActive && 'bg-slate-50 opacity-70')}>
      <button
        type="button"
        disabled={!isAdmin || upload.isPending}
        onClick={() => fileInput.current?.click()}
        title={isAdmin ? 'Cambiar foto' : undefined}
        aria-label={`Cambiar foto de ${product.name}`}
        className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200"
      >
        <ProductImage product={product} className="h-full w-full" />
        {isAdmin && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100">
            {upload.isPending ? <Spinner className="h-4 w-4" /> : <Camera className="h-5 w-5" />}
          </span>
        )}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload.mutate(file);
        }}
      />

      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate font-semibold">{product.name}</p>
        <p className="truncate text-xs text-slate-500">
          {product.code}
          {product.description ? ` · ${product.description}` : ''}
        </p>
      </div>

      {isAdmin ? (
        <label className="flex items-center gap-1.5 text-sm text-slate-500">
          Bs
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            className="w-24 text-right font-semibold tabular-nums"
            aria-label={`Precio de ${product.name}`}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            onBlur={commitPrice}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
          />
        </label>
      ) : (
        <span className="font-semibold tabular-nums">{money(product.price)}</span>
      )}

      <label className="flex items-center gap-2 text-sm">
        <Toggle label={`Disponible: ${product.name}`} checked={product.isAvailable} disabled={availability.isPending || !product.isActive} onChange={(value) => availability.mutate(value)} />
        <span className={cx('w-20', product.isAvailable ? 'text-emerald-700' : 'font-semibold text-red-700')}>{product.isAvailable ? 'Disponible' : 'Agotado'}</span>
      </label>

      {isAdmin && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
      )}
    </div>
  );
}

function ProductForm({ product, categories, onClose }: { product: Product | null; categories: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [code, setCode] = useState(product?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories.find((category) => category.isActive)?.id ?? categories[0]?.id ?? '');
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      // El backend rechaza campos de más: `code` solo al crear, y una
      // descripción vacía no se manda (no admite cadena vacía).
      const fields = {
        name: name.trim(),
        categoryId,
        price: Number(price),
        isActive,
        sortOrder: Math.trunc(Number(sortOrder) || 0),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      return product ? api.patch<Product>(`/products/${product.id}`, fields) : api.post<Product>('/products', { code: code.replace(/_+$/, ''), ...fields });
    },
    onSuccess: (saved) => {
      toast.ok(`${saved.name} guardado.`);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={product ? `Editar ${product.name}` : 'Nuevo producto'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre">
          <Input
            required
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!product && !codeTouched) setCode(slugify(event.target.value));
            }}
          />
        </Field>
        {!product && (
          <Field label="Código" hint="Identificador interno, sin espacios. No se puede cambiar después.">
            <Input
              required
              value={code}
              onChange={(event) => {
                setCodeTouched(true);
                setCode(slugify(event.target.value));
              }}
            />
          </Field>
        )}
        <Field label="Descripción (opcional)">
          <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio (Bs)">
            <Input type="number" inputMode="decimal" min={0} step="0.5" required value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field label="Orden" hint="Menor número, más arriba.">
            <Input type="number" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
          </Field>
        </div>
        <Field label="Categoría">
          <Select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.isActive ? '' : ' (oculta)'}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Toggle label="Visible en el menú" checked={isActive} onChange={setIsActive} />
          Visible en el menú
        </label>
        {save.isError && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryForm({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), sortOrder: Math.trunc(Number(sortOrder) || 0), isActive };
      return category ? api.patch<Category>(`/categories/${category.id}`, body) : api.post<Category>('/categories', body);
    },
    onSuccess: (saved) => {
      toast.ok(`Categoría ${saved.name} guardada.`);
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal title={category ? `Editar ${category.name}` : 'Nueva categoría'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre">
          <Input required autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Orden" hint="Menor número, más arriba.">
          <Input type="number" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Toggle label="Visible en el menú" checked={isActive} onChange={setIsActive} />
          Visible en el menú
        </label>
        {save.isError && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
